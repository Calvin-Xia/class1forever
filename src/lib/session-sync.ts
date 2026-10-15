/** 同 Host 标签页只广播失效信号；不广播 Cookie、口令或明细，也不据消息授予权限。 */
const CHANNEL = 'classmap-session-change';
let revision = 0;
export function readSessionRevision(): number { return revision; }
export function advanceSessionRevision(): void { revision += 1; }

export function watchSessionChanges(invalidate: () => void): {
    notify: () => void;
    dispose: () => void;
} {
    let channel: BroadcastChannel | undefined;
    try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = invalidate;
    } catch {
        // 禁用 BroadcastChannel 的浏览器仍可用 storage 事件；两者都禁用时靠焦点复核。
    }
    const onStorage = (event: StorageEvent): void => {
        if (event.key === CHANNEL) invalidate();
    };
    window.addEventListener('storage', onStorage);
    return {
        notify() {
            channel?.postMessage('invalidate');
            if (!channel) {
                try {
                    localStorage.setItem(CHANNEL, String(Date.now()) + Math.random());
                    localStorage.removeItem(CHANNEL);
                } catch { /* 无持久存储时仍保留网络和焦点复核。 */ }
            }
        },
        dispose() {
            channel?.close();
            window.removeEventListener('storage', onStorage);
        }
    };
}
