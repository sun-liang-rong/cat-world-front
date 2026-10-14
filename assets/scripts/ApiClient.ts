export const API_BASE_URL = 'https://hongshu.sale/cat_world_service_api';

/** 与微信 wx.request 的 timeout 保持一致的统一请求超时（毫秒）。 */
export const API_TIMEOUT_MS = 8000;

export type RankBoardType = 1 | 2 | 3;

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

export interface GeneratedProfile {
  name: string;
  user_id: string;
  submit_token: string;
}

export interface RankEntry {
  rank: number;
  user_id: string;
  name: string;
  type: RankBoardType;
  date: string | null;
  level_count: number;
  star_count: number;
  clear_count: number;
  duration_ms: number;
}

export interface SubmitRankResult {
  updated: boolean;
  record: RankEntry;
}

export interface SubmitRankPayload {
  user_id: string;
  type: RankBoardType;
  date?: string;
  level_count?: number;
  star_count?: number;
  clear_count?: number;
  duration_ms?: number;
}

export interface TrackEventPayload {
  event_id: string;
  name: string;
  ts: number;
  props?: Record<string, unknown>;
}

export interface TrackBatchPayload {
  user_id?: string;
  session_id: string;
  platform?: string;
  app_version?: string;
  events: TrackEventPayload[];
}

/** 入库回执：inserted = 数据库本次实际新插入；duplicated = 批内重复 + 与库内 event_id 冲突；dropped = 非法/未知事件拒收。 */
export interface TrackIngestResult {
  inserted: number;
  duplicated: number;
  dropped: number;
  /** @deprecated 过渡期兼容字段，恒等于 inserted，后续移除。 */
  accepted: number;
}

interface WechatRequestTask {
  abort?: () => void;
}

interface WechatApi {
  request?: (options: {
    url: string;
    method?: string;
    header?: Record<string, string>;
    data?: unknown;
    timeout?: number;
    success?: (result: { statusCode?: number; data?: unknown }) => void;
    fail?: (error: unknown) => void;
  }) => WechatRequestTask;
}

/** 失败原因细分：超时 / 网络失败 / HTTP 非成功（status > 0）/ 服务端业务错误码。 */
export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'server_code';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(
    message: string,
    readonly status = 0,
    readonly code = 0,
    kind?: ApiErrorKind,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind ?? (status > 0 ? 'http' : code > 0 ? 'server_code' : 'network');
  }
}

export class ApiClient {
  constructor(private readonly baseUrl = API_BASE_URL) {}

  generateProfile() {
    return this.request<GeneratedProfile>('POST', '/user/generate');
  }

  submitRank(payload: SubmitRankPayload, submitToken: string) {
    return this.request<SubmitRankResult>('POST', '/rank/submit', payload, {
      Authorization: `Bearer ${submitToken}`,
    });
  }

  listRank(type: RankBoardType, userId = '', date?: string) {
    const query = [`type=${type}`];
    if (userId) query.push(`user_id=${encodeURIComponent(userId)}`);
    if (date) query.push(`date=${encodeURIComponent(date)}`);
    return this.request<RankEntry[]>('GET', `/rank/list?${query.join('&')}`);
  }

  track(payload: TrackBatchPayload) {
    return this.request<TrackIngestResult>('POST', '/track', payload);
  }

  private request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // 幂等 GET 在超时/网络失败时最多重试 1 次；POST 不自动重试（由调用方按业务决定）。
    const attempts = method === 'GET' ? 2 : 1;
    const run = (attempt: number): Promise<T> => this.send(method, url, body, headers)
      .then(payload => this.unwrap<T>(payload))
      .catch(error => {
        const retryable = attempt < attempts
          && error instanceof ApiError
          && (error.kind === 'timeout' || error.kind === 'network');
        if (!retryable) throw error;
        return run(attempt + 1);
      });
    return run(1);
  }

  private send(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const wxApi = this.getWechatApi();
    if (wxApi?.request) {
      return new Promise((resolve, reject) => {
        wxApi.request!({
          url,
          method,
          header: { 'Content-Type': 'application/json', ...headers },
          data: body,
          timeout: API_TIMEOUT_MS,
          success: result => {
            if ((result.statusCode ?? 0) >= 400) {
              reject(this.toHttpError(result.data, result.statusCode ?? 0));
              return;
            }
            resolve(result.data);
          },
          fail: error => reject(this.toTransportError(error)),
        });
      });
    }

    if (typeof fetch !== 'function') {
      return Promise.reject(new ApiError('当前环境无法请求排行榜服务'));
    }

    // H5：AbortController 超时控制，定时器在 finally 清理，不留下悬挂计时器。
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    if (controller) {
      timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    }

    return fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    }).then(async response => {
      const payload = await this.parseBody(response);
      if (!response.ok) throw this.toHttpError(payload, response.status);
      return payload;
    }).catch(error => {
      if (error instanceof ApiError) throw error;
      if (controller && error?.name === 'AbortError') {
        throw new ApiError('请求超时，请稍后重试', 0, 0, 'timeout');
      }
      throw this.toTransportError(error);
    }).finally(finish);
  }

  private unwrap<T>(payload: unknown): T {
    if (!payload || typeof payload !== 'object') {
      throw new ApiError('服务返回数据异常');
    }
    const response = payload as ApiResponse<T>;
    if (typeof response.code !== 'number') {
      throw new ApiError('服务返回数据异常');
    }
    if (response.code !== 200) {
      throw new ApiError(response.message || '请求失败', response.code, response.code, 'server_code');
    }
    return response.data;
  }

  private async parseBody(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private toHttpError(payload: unknown, status: number) {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message) {
        return new ApiError(message, status, typeof (payload as { code?: unknown }).code === 'number'
          ? (payload as { code?: unknown }).code as number
          : status, 'http');
      }
    }
    return new ApiError(status >= 500 ? '服务器开小差了，请稍后重试' : '请求失败', status, 0, 'http');
  }

  private toTransportError(error: unknown) {
    if (error instanceof ApiError) return error;
    if (error instanceof Error && error.message === 'request:fail timeout') {
      return new ApiError('请求超时，请稍后重试', 0, 0, 'timeout');
    }
    if (error instanceof Error && error.message) {
      return new ApiError(error.message, 0, 0, 'network');
    }
    if (typeof error === 'string' && error) {
      return new ApiError(error, 0, 0, 'network');
    }
    return new ApiError('网络异常，请稍后重试', 0, 0, 'network');
  }

  private getWechatApi() {
    const runtime = typeof globalThis === 'undefined'
      ? null
      : globalThis as typeof globalThis & { wx?: WechatApi };
    return runtime?.wx || null;
  }
}
