/**
 * 数据集读取与地区查询规范化（迁移自 functions/_lib/data.mjs，逐字段等价）。
 *
 * 数据模型本身仍复用 `shared/data-model.mjs`：同一个文件同时服务上传脚本
 * （scripts/upload-kv-data.mjs）与运行期，复制一份到 src/lib 会让两边口径漂移。
 *
 * 契约（docs/migration-parity.md §1.3 / §1.5）：
 * - KV 绑定 `CLASS_MAP_DATA`，键 `students:raw:v1` / `students:public:v1` 不变。
 * - 参数错误（400）与数据错误（503）严格分离：这里只负责抛错，分类由路由做。
 */
import {
    DATA_KEYS,
    filterStudentsByRegion,
    normalizeProvince,
    normalizeStudents,
    sortPeople
} from '../../shared/data-model.mjs';
import type { DetailsPayload, Env, PublicDataset, Student } from './types';

/** 归一化后的地区查询：省名过别名表，city 未指定时为 null。 */
export interface NormalizedRegion {
    province: string;
    city: string | null;
}

/**
 * 校验并规范化 city 查询参数。
 * 空串 / 'null' / 'undefined'（前端把 null 拼进查询串的产物）按「未指定」处理。
 * 非字符串是调用约定错误，抛 TypeError——错误信息可直接展示给用户。
 */
function normalizeQueryCity(city: unknown): string | null {
    if (!city) {
        return null;
    }

    if (typeof city !== 'string') {
        throw new TypeError('Query parameter "city" must be a string.');
    }

    const normalized = city.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
        return null;
    }

    return normalized;
}

/** 未激活版本时保留旧键回滚；坏配置不静默退回旧版。 */
export function datasetKey(env: Env, kind: 'raw' | 'public'): string {
    const release = env.DATA_RELEASE_ID;
    // 复核裁定 #13：`DATA_RELEASE_ID` 缺省时的旧键回退（students:raw:v1 / students:public:v1）
    // 是 Cloudflare-only 的兼容路径。EdgeOne 适配器要求私有 KV 里必须有合法的 release id，
    // 缺配置时直接 503 platform_not_configured，不会读旧键；两边行为差异由文档限定。
    if (release === undefined || release === '') return DATA_KEYS[kind];
    if (!/^[A-Za-z0-9_]{1,64}$/.test(release)) throw new Error('Invalid data release configuration.');
    return `students_${kind}_${release}`;
}

/** 读公开聚合（students:public:v1）。 */
export async function loadPublicDataset(env: Env): Promise<PublicDataset> {
    const dataset = await env.CLASS_MAP_DATA.get<PublicDataset>(datasetKey(env, 'public'), 'json');
    if (!dataset || typeof dataset !== 'object') {
        throw new Error('Public map dataset is not configured in KV.');
    }

    return dataset;
}

/**
 * 明细数据集的硬上限（复核裁定 #41，fail closed）。
 *
 * 明细路由每次都把整份 students:raw 读进内存再按省过滤；没有上限时，一份异常巨大的
 * KV 值（误上传 / 被替换）就能把 isolate 打到 OOM。超过上限一律抛错，由路由转成 503，
 * 绝不「截断后返回一部分」，因为少返回的人不会以任何方式暴露出来。
 *
 * 有意延后（不在本分支做）：按省分键（students_raw_<release>_<province>）可以让每次
 * 只读需要的省、顺带突破这个上限；那会改动 KV 键布局与发布协议，属于独立的一轮工作。
 */
export const MAX_RAW_RECORDS = 5000;

/** 读明细并归一化（students:raw:v1）。 */
export async function loadRawStudents(env: Env): Promise<Student[]> {
    const students = await env.CLASS_MAP_DATA.get(datasetKey(env, 'raw'), 'json');
    if (!students) {
        throw new Error('Raw student dataset is not configured in KV.');
    }

    if (!Array.isArray(students) || students.length > MAX_RAW_RECORDS) {
        throw new Error('Raw student dataset exceeds the supported size.');
    }

    return normalizeStudents(students) as Student[];
}

/**
 * 校验并规范化地区查询参数。
 * 只做参数检查，不读 KV，方便调用方把「参数不对」和「数据读不到」分开处理。
 * 参数非法时抛错，错误信息可以直接展示给用户。
 */
export function normalizeRegionQuery(region: { province: unknown; city?: unknown }): NormalizedRegion {
    return {
        province: normalizeProvince(region.province, 'query') as string,
        city: normalizeQueryCity(region.city)
    };
}

/** 组装地区明细响应：规范化参数 → 读明细 → 过滤 → 排序。 */
export async function buildDetailsPayload(
    env: Env,
    region: { province: unknown; city?: unknown }
): Promise<DetailsPayload> {
    const normalizedRegion = normalizeRegionQuery(region);
    const students = await loadRawStudents(env);
    const people: Student[] = sortPeople(filterStudentsByRegion(students, normalizedRegion));

    return {
        province: normalizedRegion.province,
        city: normalizedRegion.city,
        count: people.length,
        people
    };
}
