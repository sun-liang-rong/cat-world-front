// 由 cat-world/scripts/generate_track_contract.js 从 analytics/track-events.json 生成，勿手改。
// 目录版本 v2；客户端 TrackEventName / TrackProps 类型。

export const TRACK_EVENT_VERSION = 2;

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
  'tool_supply_claim',
  'level_resume',
  'cat_skill_use',
] as const;

export type TrackEventName = (typeof TRACK_EVENT_NAMES)[number];

export const TRACK_PROP_SCHEMAS: Record<TrackEventName, Record<string, string>> = {
  "app_launch": {
    "is_new_user": "boolean",
    "has_profile": "boolean"
  },
  "loading_finish": {
    "duration_ms": "number"
  },
  "page_view": {
    "page_id": "string",
    "mode": "string",
    "level": "number",
    "result": "string"
  },
  "level_enter_click": {
    "mode": "string",
    "level": "number"
  },
  "level_start": {
    "mode": "string",
    "level": "number"
  },
  "level_end": {
    "mode": "string",
    "level": "number",
    "result": "string",
    "duration_ms": "number",
    "collected": "number",
    "match_count": "number",
    "remaining_slots": "number",
    "fail_had_pair": "boolean_null",
    "fail_progress": "number_null",
    "revive_used": "boolean",
    "used_items": "string[]"
  },
  "level_next": {
    "mode": "string",
    "level": "number"
  },
  "level_replay": {
    "mode": "string",
    "level": "number"
  },
  "level_home": {
    "mode": "string",
    "level": "number",
    "mid_run": "boolean"
  },
  "level_go_build": {
    "mode": "string",
    "level": "number"
  },
  "tutorial_done": {
    "level": "number",
    "mode": "string"
  },
  "ad_entrance_show": {
    "scene": "string"
  },
  "ad_click": {
    "scene": "string"
  },
  "ad_result": {
    "scene": "string",
    "result": "string",
    "simulated": "boolean"
  },
  "building_light": {
    "building_id": "string",
    "stage": "number",
    "sub_progress": "number",
    "cell_count": "number",
    "stage_completed": "boolean",
    "building_completed": "boolean"
  },
  "shop_buy": {
    "item_id": "string",
    "price": "number"
  },
  "cat_trial_offer_show": {
    "cat_id": "string",
    "remaining_games": "number"
  },
  "cat_trial_offer_click": {
    "accepted": "boolean"
  },
  "cat_trial_start": {
    "cat_id": "string",
    "remaining_games": "number"
  },
  "cat_trial_game_start": {
    "cat_id": "string",
    "remaining_games": "number"
  },
  "cat_trial_game_end": {
    "level": "number",
    "remaining_games": "number",
    "trial_result": "string",
    "skill_used": "boolean"
  },
  "cat_trial_expire": {
    "level": "number",
    "trial_result": "string"
  },
  "cat_trial_converted": {
    "cat_id": "string"
  },
  "challenge_locked_click": {
    "required_level": "number",
    "current_level": "number"
  },
  "challenge_lock_show": {
    "current_level": "number"
  },
  "challenge_unlock_show": {
    "current_level": "number"
  },
  "journey_start": {
    "day": "number"
  },
  "journey_open": {},
  "journey_claim": {
    "day": "number",
    "reward": "string",
    "completed": "boolean"
  },
  "journey_complete": {
    "day": "number"
  },
  "town_daily_show": {
    "task_id": "string"
  },
  "town_daily_complete": {
    "task_id": "string"
  },
  "town_daily_reward_claim": {
    "task_id": "string",
    "reward": "string"
  },
  "town_cat_dialogue_show": {
    "building_id": "string"
  },
  "town_stage_complete": {
    "building_id": "string",
    "stage": "number",
    "building_completed": "boolean"
  },
  "cat_milestone_unlock": {
    "cat_id": "string",
    "level": "number",
    "milestone_levels": "string"
  },
  "cat_upgrade": {
    "cat_id": "string",
    "level": "number",
    "cost": "number",
    "milestone_unlocked": "boolean"
  },
  "cat_interact": {
    "cat_id": "string",
    "interaction": "string"
  },
  "cat_skill_gift": {
    "cat_id": "string",
    "coins": "number"
  },
  "share_entrance_show": {
    "card_type": "string",
    "prompt": "string"
  },
  "share_click": {
    "card_type": "string",
    "item_id": "string",
    "scene": "string"
  },
  "share_result": {
    "card_type": "string",
    "result": "string",
    "platform": "string",
    "item_id": "string",
    "scene": "string"
  },
  "share_reward_claim": {
    "card_type": "string",
    "reward": "string"
  },
  "share_card_open": {
    "card_type": "string"
  },
  "tool_supply_claim": {
    "item_id": "string"
  },
  "level_resume": {
    "mode": "string",
    "level": "number"
  },
  "cat_skill_use": {
    "cat_id": "string",
    "mode": "string",
    "level": "number"
  }
};

/** 允许上报的事件属性类型：仅有限原语，禁止任意对象。 */
export type TrackProps = Record<string, string | number | boolean | string[] | null>;
