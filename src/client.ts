import * as net from 'net';
import * as vscode from 'vscode';

// 假设你的本地服务器运行在 127.0.0.1:8080
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;

// 定义服务器请求的格式
interface RequestPayload {
    command: 'generate' | 'edit';
    prompt: string;
    context: string; // 选中的代码或整个文件的内容
}

/**
 * 负责与本地代码生成服务器进行 Socket 通信
 */
export class CodeGenClient {
    private client: net.Socket | null = null;
    private connectionPromise: Promise<net.Socket> | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * 确保 Socket 连接是建立且活动的
     */
    private async ensureConnection(): Promise<net.Socket> {
        if (this.client && !this.client.destroyed) {
            return this.client;
        }

        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.outputChannel.appendLine(`Attempting to connect to server at ${SERVER_HOST}:${SERVER_PORT}...`);

        this.connectionPromise = new Promise((resolve, reject) => {
            const socket = new net.Socket();
            
            socket.connect(SERVER_PORT, SERVER_HOST, () => {
                this.outputChannel.appendLine('Successfully connected to local server.');
                this.client = socket;
                this.connectionPromise = null;
                resolve(socket);
            });

            socket.on('error', (err) => {
                const message = `Connection Error: Failed to connect to local server: ${err.message}`;
                this.outputChannel.appendLine(message);
                this.client = null;
                this.connectionPromise = null;
                vscode.window.showErrorMessage(message);
                reject(new Error(message));
            });

            socket.on('close', () => {
                this.outputChannel.appendLine('Connection closed.');
                this.client = null;
            });
            
            socket.on('end', () => {
                this.outputChannel.appendLine('Server disconnected.');
                this.client = null;
            });
        });

        return this.connectionPromise;
    }

    /**
     * 发送请求到服务器并接收响应
     * @param payload 请求负载
     * @returns 服务器返回的代码字符串
     */
    public async sendRequest(payload: RequestPayload): Promise<string> {
        try {
            const socket = await this.ensureConnection();
            
            const requestData = JSON.stringify(payload) + '\n'; // 假设以 JSON + 换行符发送
            socket.write(requestData);

            return new Promise((resolve, reject) => {
                let responseData = '';
                // 监听一次性数据响应
                const dataListener = (data: Buffer) => {
                    responseData += data.toString();
                    
                    // 假设服务器返回的内容以特定的结束标记 (例如：一个空行或另一个固定的分隔符) 结束
                    // 对于 Socket 通信，最好的做法是使用固定的消息头(如：长度)或明确的结束符
                    // 这里我们简单假设一个换行符作为结束符，但这在实际中可能需要更复杂的协议来处理流式数据。
                    if (responseData.endsWith('\n')) {
                        // 移除末尾的换行符
                        const finalResponse = responseData.trim();
                        // 移除监听器以防止后续数据干扰
                        socket.off('data', dataListener);
                        resolve(finalResponse);
                    }
                };
                
                socket.on('data', dataListener);

                // 设置超时机制
                const timeout = setTimeout(() => {
                    socket.off('data', dataListener);
                    reject(new Error("Server response timed out (120s)."));
                }, 120000); // 120秒超时

                // 错误处理
                socket.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(new Error(`Socket communication error: ${err.message}`));
                });

            });

        } catch (error) {
            const errorMessage = `Failed to send request to local server: ${error instanceof Error ? error.message : String(error)}`;
            this.outputChannel.appendLine(errorMessage);
            throw new Error(errorMessage);
        }
    }
}