import type { InjectionKey } from "vue";

/** 搜索渠道：全部 / 网易云 / QQ 音乐 */
export type SearchChannel = "all" | "netease" | "tencent";

export interface SearchChannelOption {
  value: Exclude<SearchChannel, "all">;
  label: string;
}

/** 搜索页与结果列表共享的渠道筛选状态 */
export interface SearchChannelFilterState {
  /** 当前选中的渠道 */
  selected: SearchChannel;
  /** 当前结果里真正有内容的渠道 */
  channels: SearchChannelOption[];
}

const searchChannelFilterKey: InjectionKey<SearchChannelFilterState> =
  Symbol("search-channel-filter");

/** 搜索页提供渠道筛选状态 */
export const provideSearchChannelFilter = (): SearchChannelFilterState => {
  const state = reactive<SearchChannelFilterState>({
    selected: "all",
    channels: [],
  });
  provide(searchChannelFilterKey, state);
  return state;
};

/** 搜索结果页读取渠道筛选状态 */
export const useSearchChannelFilter = (): SearchChannelFilterState | null =>
  inject(searchChannelFilterKey, null);
