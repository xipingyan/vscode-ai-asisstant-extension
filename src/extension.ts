import * as vscode from 'vscode';
import { CodeGenClient, ResponsePayload } from './client';

let codeGenClient: CodeGenClient;
let outputChannel: vscode.OutputChannel;

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

                const generatedCodeStr = responsePayload.code;
                const document = editor.document;

                // 3. 为每一行代码添加缩进，基于光标位置
                // 获取光标所在行的文本
                const currentLine = document.lineAt(position.line);
                // 获取当前行的缩进字符串 (例如 '    ' 或 '\t\t')
                const indentation = currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex);
                // 为生成的代码的每一行添加缩进（除了第一行，因为它将自动继承位置的缩进）
                const indentedCode = generatedCodeStr.split('\n')
                    .map((line, index) => {
                        // 如果是空行或第一行，不需要添加额外的缩进
                        if (index === 0) return line;
                        if (line.trim().length === 0) return line;
                        return indentation + line;
                    })
                    .join('\n');

                // 4. 确保代码插入操作是 await 等待的
                const editApplied = await editor.edit(editBuilder => {
                    editBuilder.insert(position, indentedCode);
                });

                vscode.window.showInformationMessage('Code generation complete.');

            } catch (error) {
                const message = `Local AI Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
                vscode.window.showErrorMessage(message);
            }
        });
    });
    
    // --- 1.2 命令：处理选中的代码 (右键菜单) ---
    let disposableProcessSelection = vscode.commands.registerCommand('vscode-ai-asisstant-extension.generateCodeFromSelection', async () => {
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

                // 替换选中的代码为服务器返回的结果
                // 这里的逻辑可以修改为：插入到选中代码的后面，或显示在新的窗口，取决于你的需求。
                // 默认：直接替换选中内容
                editor.edit(editBuilder => {
                    editBuilder.replace(selection, processedCode);
                });

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
