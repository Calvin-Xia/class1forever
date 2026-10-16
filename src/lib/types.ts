/**
 * 跨路由共享的最小数据形状（迁移自 functions/_lib/* 与 shared/data-model.mjs）。
 *
 * 契约冻结在 docs/migration-parity.md §1：这里的每个字段都对应 KV 里实际写入的结构，
 * 或对应路由响应体里的一个字段。字段名/可选性一旦改动就等于改对外契约，
 * 必须同步 migration-parity.md 并重新比对旧站响应。
 */

/**
 * 运行时绑定与变量：由 wrangler types 生成在仓库根 worker-configuration.d.ts，
 * 这里只做一层别名，避免每个模块各自 `Cloudflare.Env`。
 */
export interface DataStore {
    get(key: string): Promise<string | null>;
    get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
}

/** 平台只注入存储、变量和可信 IP；业务模块不依赖平台运行时。 */
export interface Env {
    CLASS_MAP_DATA: DataStore;
    DETAILS_PASSPHRASE?: string;
    DETAILS_SESSION_SECRET?: string;
    DETAILS_HINT?: string;
    DATA_RELEASE_ID?: string;
    /**
     * 平台提供的可信客户端 IP（复核裁定 #40，必填）。
     * Cloudflare：`CF-Connecting-IP`，缺失记 `'unknown'`；
     * Makers：`request.eo.clientIp`（登录路由在缺失时 fail closed）。
     * 业务层只读这个字段，绝不回退到客户端可伪造的 `X-Forwarded-For` 之流。
     */
    trustedClientIp: string;
}

/** 公开聚合里的计数（students:public:v1 的 stats）。 */
export interface PublicDatasetStats {
    /** 总人数。 */
    total: number;
    /** 覆盖省级区域数（去重）。 */
    provinces: number;
    /** 覆盖城市数（去重「省::市」）。 */
    cities: number;
}

/** 单个省的公开聚合：只含计数，不含姓名与学校。 */
export interface ProvinceAggregate {
    count: number;
    cities: Record<string, number>;
}

/** KV `students:public:v1` 的形状（buildPublicDataset 的产物）。 */
export interface PublicDataset {
    version: string;
    generatedAt: string;
    stats: PublicDatasetStats;
    provinces: Record<string, ProvinceAggregate>;
}

/**
 * 规范化后的学生记录：`province` 已过别名表，四个字段都已 trim + 折叠空白。
 * KV `students:raw:v1` 里存的是原始记录，由 normalizeStudents 归一到这里。
 */
export interface Student {
    name: string;
    school: string;
    city: string;
    province: string;
}

/** `GET /api/map/details` 的响应体。 */
export interface DetailsPayload {
    /** 规范化后的省名。 */
    province: string;
    /** 规范化后的城市名；未指定时为 null。 */
    city: string | null;
    count: number;
    /** 排序：city → school → name（localeCompare('zh-CN')）。 */
    people: Student[];
}

/** `GET /api/map/public` 的响应体：聚合数据展开后叠加三个开关字段。 */
export interface PublicMapPayload extends PublicDataset {
    /** 本次请求是否带有效会话。 */
    detailAccess: boolean;
    /** 服务端是否配齐了口令与会话密钥。 */
    detailModeAvailable: boolean;
    /** 给前端展示的提示语，未配置时为空串（字段仍存在）。 */
    detailsHint: string;
}

/** 错误响应体形状（errorResponse 的产物）。 */
export interface ErrorPayload {
    error: string;
    message: string;
    [extra: string]: unknown;
}
