import * as net from 'net';
import * as vscode from 'vscode';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 8080; // 请根据您的本地 Server 配置修改

/**
 * 封装 Socket 通信
 * @param dataToSend 发送给服务器的数据对象 (prompt, context, type)
 * @returns Server 返回的代码字符串
 */
export async function sendToServer(dataToSend: any): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let responseData = '';

        client.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log('Connected to local server');
            // 确保发送 JSON 格式的数据
            client.write(JSON.stringify(dataToSend));
        });

        client.on('data', (data) => {
            responseData += data.toString();
        });

        client.on('end', () => {
            console.log('Connection closed by server');
            try {
                // 假设服务器返回的是一个包含 'code' 字段的 JSON 字符串
                const result = JSON.parse(responseData);
                resolve(result.code || responseData); // 如果解析失败，直接返回原始数据
            } catch (e) {
                // 如果服务器返回的不是 JSON，直接返回原始数据
                resolve(responseData);
            }
        });

        client.on('error', (err) => {
            console.error('Socket error:', err.message);
            vscode.window.showErrorMessage(`Failed to connect to local AI server: ${err.message}`);
            client.destroy();
            reject(new Error(`Socket connection failed: ${err.message}`));
        });

        client.on('close', () => {
            console.log('Connection fully closed');
        });
    });
}