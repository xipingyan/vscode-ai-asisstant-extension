import * as net from 'net';
import * as vscode from 'vscode';

// 假设你的本地服务器运行在 127.0.0.1:8080
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080;

// 定义服务器请求的格式
interface RequestPayload {
    type: 'generate' | 'edit';
    prompt: string;
    language: string;
    context: string; // 选中的代码或整个文件的内容
}

export interface ResponsePayload {
    status: 'success' | 'error';
    code: string; // 生成或编辑的代码
    message: string; 
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
            
            const requestData = JSON.stringify(payload); // 假设以 JSON 发送
            // socket.write(requestData);

            // 使用 end() 代替 write() + shutdown(SHUT_WR)
            socket.end(requestData);

            return new Promise((resolve, reject) => {
                let responseData = '';
                const TIMEOUT_MS = 120000; // 120秒超时
                // 1. 数据监听器：持续接收服务器返回的响应数据
                const dataListener = (data: Buffer) => {
                    responseData += data.toString();
                };

                // 2. 错误/结束处理器
                const cleanup = (err?: Error) => {
                    clearTimeout(timeout);
                    socket.off('data', dataListener);
                    // 确保错误或结束时移除其他一次性监听器
                    socket.off('end', endListener);
                    socket.off('error', errorListener);
                    if (err) {
                        reject(err);
                    }
                };

                // 3. 服务器响应完成处理器：当服务器发送 FIN 包时触发
                const endListener = () => {
                    cleanup();
                    // 只有在没有错误且连接正常结束时才 resolve
                    resolve(responseData.trim());
                };

                // 4. 错误处理器
                const errorListener = (err: Error) => {
                    cleanup(new Error(`Socket communication error during response: ${err.message}`));
                };
                
                // 5. 超时机制
                const timeout = setTimeout(() => {
                    cleanup(new Error(`Server response timed out (${TIMEOUT_MS/1000}s).`));
                }, TIMEOUT_MS);

                socket.on('data', dataListener);
                socket.once('end', endListener);
                socket.once('error', errorListener);
            });

        } catch (error) {
            const errorMessage = `Failed to send request to local server: ${error instanceof Error ? error.message : String(error)}`;
            this.outputChannel.appendLine(errorMessage);
            throw new Error(errorMessage);
        }
    }
}