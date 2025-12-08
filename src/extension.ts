import * as vscode from 'vscode';
import { CodeGenClient, ResponsePayload } from './client';

let codeGenClient: CodeGenClient;
let outputChannel: vscode.OutputChannel;

/**
 * 插入代码到编辑器，并尝试格式化该区域。
 * @param editor 当前活动的文本编辑器
 * @param position 插入的起始位置
 * @param codeToInsert 待插入的原始代码字符串
 * @param applyIndentation 是否应用手动缩进（替代自动格式化）
 */
async function insertAndFormatCode(
    editor: vscode.TextEditor,
    position: vscode.Position,
    codeToInsert: string,
    applyIndentation: boolean = false
): Promise<void> {
    const document = editor.document;

    // 默认插入内容：在代码前后添加换行符，以确保它能形成一个独立的块，利于格式化。
    let finalCode = codeToInsert;

    // 如果选择手动缩进（适用于简单的代码块，或者自动格式化器不可用时）
    if (applyIndentation) {
        // 1. 获取当前行的缩进字符串
        const currentLine = document.lineAt(position.line);
        const indentation = currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex);

        // 2. 为生成的代码的每一行添加缩进（除了第一行）
        const indentedLines = codeToInsert.split('\n')
            .map((line, index) => {
                // 第一行、空行不需要额外缩进
                if (index === 0 || line.trim().length === 0) return line;
                return indentation + line;
            });

        finalCode = indentedLines.join('\n');
    }

    // 记录插入前的文档版本，用于计算范围
    const initialText = document.getText();
    const insertOffset = document.offsetAt(position);

    // 3. 执行代码插入
    const editApplied = await editor.edit(editBuilder => {
        editBuilder.insert(position, finalCode);
    });

    if (editApplied) {
        // 如果没有使用手动缩进，则尝试触发 VS Code 自动格式化
        if (!applyIndentation) {

            // 4. 计算格式化范围
            // 插入后的文本长度
            const insertedLength = finalCode.length;
            const insertEndOffset = insertOffset + insertedLength;

            // 将 offset 转换为 Position
            const rangeEndPosition = document.positionAt(insertEndOffset);

            // 创建一个 Range，从插入代码的起始行开始，到结束行结束
            const formatRange = new vscode.Range(
                new vscode.Position(position.line, 0), // 从插入行的行首开始
                new vscode.Position(rangeEndPosition.line + 1, 0) // 到插入代码结束位置的下一行行首
            );

            // 5. 触发指定范围的格式化命令
            try {
                // 推荐使用 executeFormatRangeProvider 对插入的范围进行格式化
                await vscode.commands.executeCommand(
                    'vscode.executeFormatRangeProvider',
                    document.uri,
                    formatRange
                );
            } catch (e) {
                // 如果格式化失败（例如：当前文件语言没有格式化提供者），继续执行，但不报错
                // outputChannel.appendLine(`Warning: Auto-formatting failed: ${e}`);
            }
        }
    } else {
        throw new Error('Code insertion failed due to a concurrent edit or other issue.');
    }
}

/**
 * 插件激活时执行
 * @param context 
 */
export function activate(context: vscode.ExtensionContext) {
    
    // 创建一个输出通道用于调试和显示连接状态
    outputChannel = vscode.window.createOutputChannel("Local CodeGen Assistant");
    context.subscriptions.push(outputChannel);
    
    // 初始化 Socket 客户端
    codeGenClient = new CodeGenClient(outputChannel);

    // --- 1.1 命令：在光标位置生成代码 (右键菜单) ---
    let disposableGenerate = vscode.commands.registerCommand('vscode-ai-asisstant-extension.generateCodeAtCursor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return; // 没有活动的文本编辑器
        }

        // 弹出输入框获取 Prompt
        const prompt = await vscode.window.showInputBox({
            prompt: 'Enter the prompt for code generation:',
            placeHolder: 'e.g., A Python function to calculate Fibonacci series.'
        });

        if (!prompt) {
            return; // 用户取消输入
        }

        const position = editor.selection.active;
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating code with Local AI...",
            cancellable: false
        }, async (progress) => {
            try {
                // 构造请求 payload
                const payload = {
                    type: 'generate' as const,
                    prompt: prompt,
                    language: 'cpp' as const,
                    context: 'Chosed codes for type edit.' // 仅使用 prompt
                };
				
                vscode.window.showInformationMessage('Start to send:\n' + payload);

                const generatedCode = await codeGenClient.sendRequest(payload);

                // --- 解析和处理响应 ---
                // 1. 解析 JSON 字符串
                let responsePayload: ResponsePayload;
                try {
                    responsePayload = JSON.parse(generatedCode);
                } catch (e) {
                    throw new Error(`Failed to parse server response as JSON: ${e instanceof Error ? e.message : String(e)}`);
                }

                // 2. 检查 status 字段
                if (responsePayload.status !== 'success') {
                    // 如果状态不是 success，抛出错误并显示服务器返回的消息
                    const errorMsg = responsePayload.message || 'Server returned an error status without a specific message.';
                    vscode.window.showInformationMessage(errorMsg);
                    return;
                }

                await insertAndFormatCode(editor, position, responsePayload.code, true);

                vscode.window.showInformationMessage('Code generation complete.');

            } catch (error) {
                const message = `Local AI Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
                vscode.window.showErrorMessage(message);
            }
        });
    });
    
    // --- 1.2 命令：处理选中的代码 (右键菜单) ---
    let disposableProcessSelection = vscode.commands.registerCommand('vscode-ai-asisstant-extension.refactorSelectedCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('Please select some code to process.');
            return;
        }

        const selectedText = editor.document.getText(selection);

        // 弹出输入框获取操作指令 (Prompt)
        const prompt = await vscode.window.showInputBox({
            prompt: 'Enter the instruction for the selected code:',
            placeHolder: 'e.g., Refactor this function to use list comprehension.'
        });

        if (!prompt) {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Processing selection with Local AI...",
            cancellable: false
        }, async (progress) => {
            try {
                // 构造请求 payload
                const payload = {
                    type: 'edit' as const,
                    prompt: prompt,
                    language: "cpp" as const,
                    context: selectedText // 选中的代码作为上下文
                };

                const processedCode = await codeGenClient.sendRequest(payload);

                // --- 解析和处理响应 ---
                // 1. 解析 JSON 字符串
                let responsePayload: ResponsePayload;
                try {
                    responsePayload = JSON.parse(processedCode);
                } catch (e) {
                    throw new Error(`Failed to parse server response as JSON: ${e instanceof Error ? e.message : String(e)}`);
                }

                // 2. 检查 status 字段
                if (responsePayload.status !== 'success') {
                    // 如果状态不是 success，抛出错误并显示服务器返回的消息
                    const errorMsg = responsePayload.message || 'Server returned an error status without a specific message.';
                    vscode.window.showInformationMessage(errorMsg);
                    return;
                }

                await insertAndFormatCode(editor, selection.active, responsePayload.code, true);

                vscode.window.showInformationMessage('Code processing complete.');

            } catch (error) {
                const message = `Local AI Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
                vscode.window.showErrorMessage(message);
            }
        });
    });

    context.subscriptions.push(disposableGenerate, disposableProcessSelection);
}

/**
 * 插件被停用时执行
 */
export function deactivate() {}
