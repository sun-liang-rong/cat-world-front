export const API_BASE_URL = 'https://hongshu.sale/cat_world_service_api';

export type RankBoardType = 1 | 2 | 3;

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

export interface GeneratedProfile {
  name: string;
  user_id: string;
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(private readonly baseUrl = API_BASE_URL) {}

  generateProfile() {
    return this.request<GeneratedProfile>('POST', '/user/generate');
  }

  submitRank(payload: SubmitRankPayload) {
    return this.request<SubmitRankResult>('POST', '/rank/submit', payload);
  }

  listRank(type: RankBoardType, userId: string, date?: string) {
    const query = [`type=${type}`, `user_id=${encodeURIComponent(userId)}`];
    if (date) query.push(`date=${encodeURIComponent(date)}`);
    return this.request<RankEntry[]>('GET', `/rank/list?${query.join('&')}`);
  }

  private request<T>(method: 'GET' | 'POST', path: string, body?: unknown) {
    const url = `${this.baseUrl}${path}`;
    return this.send(method, url, body).then(payload => this.unwrap<T>(payload));
  }

  private send(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
    const wxApi = this.getWechatApi();
    if (wxApi?.request) {
      return new Promise((resolve, reject) => {
        wxApi.request!({
          url,
          method,
          header: { 'Content-Type': 'application/json' },
          data: body,
          timeout: 8000,
          success: result => {
            if ((result.statusCode ?? 0) >= 400) {
              reject(this.toError(result.data, result.statusCode ?? 0));
              return;
            }
            resolve(result.data);
          },
          fail: error => reject(new ApiError(this.errorMessage(error), 0)),
        });
      });
    }

    if (typeof fetch !== 'function') {
      return Promise.reject(new ApiError('当前环境无法请求排行榜服务'));
    }

    return fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async response => {
      const payload = await this.parseBody(response);
      if (!response.ok) throw this.toError(payload, response.status);
      return payload;
    }).catch(error => {
      if (error instanceof ApiError) throw error;
      throw new ApiError(this.errorMessage(error));
    });
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
      throw new ApiError(response.message || '请求失败', response.code, response.code);
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

  private toError(payload: unknown, status: number) {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message) {
        return new ApiError(message, status, typeof (payload as { code?: unknown }).code === 'number'
          ? (payload as { code?: unknown }).code as number
          : status);
      }
    }
    return new ApiError(status >= 500 ? '服务器开小差了，请稍后重试' : '请求失败', status);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return '网络异常，请稍后重试';
  }

  private getWechatApi() {
    const runtime = typeof globalThis === 'undefined'
      ? null
      : globalThis as typeof globalThis & { wx?: WechatApi };
    return runtime?.wx || null;
  }
}
