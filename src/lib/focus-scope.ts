/**
 * 焦点作用域（从 `js/map.js` 的 `FocusScope` 忠实迁移，对应 migration-parity A8）。
 *
 * 打开对话框时把背景设为 `inert`、记住焦点来源，关闭时再归还：
 * - 用**栈**而不是单个变量，是因为底部面板之上还能再开口令弹窗：
 *   内层关闭时不能把外层仍然需要的 `inert` 一起解除；
 * - `inert` 生效的瞬间浏览器就会把焦点移出背景，所以必须在设置 `inert` **之前**
 *   记录 `activeElement`，否则拿到的永远是 `body`；
 * - `body` / `documentElement` 也有 `focus()`，直接调用不报错但也聚焦不到东西，
 *   要排除掉，否则「焦点来源不可用」会被误判成归还成功。
 *
 * 本模块只碰焦点与 `inert`，不知道抽屉/弹窗的业务；调用方（`dialogs-island.ts`）
 * 负责在合适的时机 open / close。
 */

export interface FocusScopeOptions {
    /** 打开期间要置 `inert` 的背景元素（可以是尚未取到的 null）。 */
    inert?: Array<HTMLElement | null>;
    /** 打开后要移入焦点的元素。 */
    focus?: HTMLElement | null;
    /** 焦点来源已不可用时的兜底目标（如 `#map` 这个焦点锚点）。 */
    fallback?: HTMLElement | null;
}

export interface FocusScopeEntry {
    /** 打开之前持有焦点的元素。 */
    restore: Element | null;
    fallback: HTMLElement | null;
    /** 本次真正置为 inert 的元素（外层已经置过的不重复记）。 */
    inerted: HTMLElement[];
}

const stack: FocusScopeEntry[] = [];

function isFocusTarget(element: Element | null): element is HTMLElement {
    return (
        Boolean(element) &&
        element !== document.body &&
        element !== document.documentElement &&
        typeof (element as HTMLElement).focus === 'function' &&
        document.contains(element)
    );
}

function focusSafely(element: Element | null): boolean {
    if (isFocusTarget(element)) {
        element.focus({ preventScroll: true });
        return true;
    }
    return false;
}

export function openFocusScope(options: FocusScopeOptions): FocusScopeEntry {
    const entry: FocusScopeEntry = {
        restore: document.activeElement,
        fallback: options.fallback || null,
        inerted: []
    };

    (options.inert || []).forEach((element) => {
        if (element && !element.inert) {
            element.inert = true;
            entry.inerted.push(element);
        }
    });

    stack.push(entry);

    if (options.focus) {
        focusSafely(options.focus);
    }

    return entry;
}

export function closeFocusScope(entry: FocusScopeEntry | null): void {
    if (!entry) {
        return;
    }

    const index = stack.indexOf(entry);
    if (index === -1) {
        return;
    }
    stack.splice(index, 1);

    entry.inerted.forEach((element) => {
        const stillNeeded = stack.some((outer) => outer.inerted.indexOf(element) !== -1);
        if (!stillNeeded) {
            element.inert = false;
        }
    });

    // 触发元素可能已经不在文档里（面板内容被重建过），那就退到兜底目标。
    if (!focusSafely(entry.restore)) {
        focusSafely(entry.fallback);
    }
}

/** 探针用：当前打开的作用域层数（验收脚本据此确认没有泄漏的 inert）。 */
export function focusScopeDepth(): number {
    return stack.length;
}
