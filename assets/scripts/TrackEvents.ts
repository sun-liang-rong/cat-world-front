// 由 cat-world/scripts/generate_track_contract.js 从 analytics/track-events.json 生成，勿手改。
// 目录版本 v1；客户端 TrackEventName / TrackProps 类型。

export const TRACK_EVENT_VERSION = 1;

export const TRACK_EVENT_NAMES = [
  'app_launch',
  'loading_finish',
  'page_view',
  'level_enter_click',
  'level_start',
  'level_end',
  'level_next',
  'level_replay',
  'level_home',
  'level_go_build',
  'tutorial_done',
  'ad_entrance_show',
  'ad_click',
  'ad_result',
  'building_light',
  'shop_buy',
  'cat_trial_offer_show',
  'cat_trial_offer_click',
  'cat_trial_start',
  'cat_trial_game_start',
  'cat_trial_game_end',
  'cat_trial_expire',
  'cat_trial_converted',
  'challenge_locked_click',
  'challenge_lock_show',
  'challenge_unlock_show',
  'journey_start',
  'journey_open',
  'journey_claim',
  'journey_complete',
  'town_daily_show',
  'town_daily_complete',
  'town_daily_reward_claim',
  'town_cat_dialogue_show',
  'town_stage_complete',
  'cat_milestone_unlock',
  'cat_upgrade',
  'cat_interact',
  'cat_skill_gift',
  'share_entrance_show',
  'share_click',
  'share_result',
  'share_reward_claim',
  'share_card_open',
  'tool_share_claim',
] as const;

export type TrackEventName = (typeof TRACK_EVENT_NAMES)[number];

/** 允许上报的事件属性类型：仅有限原语，禁止任意对象。 */
export type TrackProps = Record<string, string | number | boolean | string[] | null>;
