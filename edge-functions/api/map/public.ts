import { edgeoneApi } from '../../../src/platform/edgeone';
import type { EdgeContext, MakersKV } from '../../../src/platform/edgeone';

declare const CLASS_MAP_DATA: MakersKV;

export default function onRequest(context: EdgeContext): Promise<Response> {
    return edgeoneApi(context, typeof CLASS_MAP_DATA === 'undefined' ? undefined : CLASS_MAP_DATA);
}
