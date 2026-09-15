import {
    DATA_KEYS,
    filterStudentsByRegion,
    normalizeProvince,
    normalizeStudents,
    sortPeople
} from '../../shared/data-model.mjs';

function normalizeQueryCity(city) {
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

export async function loadPublicDataset(env) {
    const dataset = await env.CLASS_MAP_DATA.get(DATA_KEYS.public, 'json');
    if (!dataset || typeof dataset !== 'object') {
        throw new Error('Public map dataset is not configured in KV.');
    }

    return dataset;
}

export async function loadRawStudents(env) {
    const students = await env.CLASS_MAP_DATA.get(DATA_KEYS.raw, 'json');
    if (!students) {
        throw new Error('Raw student dataset is not configured in KV.');
    }

    return normalizeStudents(students);
}

/**
 * 校验并规范化地区查询参数。
 * 只做参数检查，不读 KV，方便调用方把「参数不对」和「数据读不到」分开处理。
 * 参数非法时抛错，错误信息可以直接展示给用户。
 */
export function normalizeRegionQuery(region) {
    return {
        province: normalizeProvince(region.province, 'query'),
        city: normalizeQueryCity(region.city)
    };
}

export async function buildDetailsPayload(env, region) {
    const normalizedRegion = normalizeRegionQuery(region);
    const students = await loadRawStudents(env);
    const people = sortPeople(filterStudentsByRegion(students, normalizedRegion));

    return {
        province: normalizedRegion.province,
        city: normalizedRegion.city,
        count: people.length,
        people
    };
}

