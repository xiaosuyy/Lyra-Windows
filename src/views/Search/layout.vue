<template>
  <div class="search">
    <div class="title">
      <n-text class="keyword">{{ searchKeyword }}</n-text>
      <n-text depth="3">的相关搜索</n-text>
      <n-popselect
        v-if="searchType === 'search-songs' && filterState.channels.length > 0"
        v-model:value="filterState.selected"
        :options="channelOptions"
        trigger="click"
        size="small"
      >
        <button
          type="button"
          class="channel-btn"
          :class="{ active: filterState.selected !== 'all' }"
          title="筛选渠道"
          aria-label="筛选渠道"
        >
          <SvgIcon name="Search" :size="16" />
        </button>
      </n-popselect>
    </div>
    <!-- 标签页 -->
    <n-tabs v-model:value="searchType" class="tabs" type="segment" @update:value="tabChange">
      <n-tab name="search-songs"> 单曲 </n-tab>
      <n-tab name="search-playlists"> 歌单 </n-tab>
      <n-tab name="search-artists"> 歌手 </n-tab>
      <n-tab name="search-albums"> 专辑 </n-tab>
      <n-tab name="search-videos"> 视频 </n-tab>
      <n-tab name="search-radios"> 播客 </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component
            :is="Component"
            :key="route.fullPath"
            :keyword="searchKeyword"
            class="router-view"
          />
        </KeepAlive>
        <component
          v-else
          :is="Component"
          :key="route.fullPath"
          :keyword="searchKeyword"
          class="router-view"
        />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { provideSearchChannelFilter } from "@/composables/useSearchChannelFilter";
const route = useRoute();
const router = useRouter();
const settingStore = useSettingStore();

// 搜索关键词
const searchKeyword = computed(() => route.query.keyword as string);

// 搜索分类
const searchType = ref<string>("search-songs");

// 渠道筛选（结果页上报有内容的渠道）
const filterState = provideSearchChannelFilter();
const channelOptions = computed(() => [
  { label: "全部渠道", value: "all" },
  ...filterState.channels.map((item) => ({ label: item.label, value: item.value })),
]);

// Tabs 改变
const tabChange = (value: string) => {
  router.push({
    name: value,
    query: {
      keyword: searchKeyword.value,
    },
  });
};

// 监听路由变化，同步 Tab 状态
watch(
  () => route.name,
  (name) => {
    if (name && name.toString().startsWith("search-")) {
      searchType.value = name as string;
    }
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.search {
  display: flex;
  flex-direction: column;
  height: 100%;
  .title {
    margin-top: 12px;
    margin-bottom: 12px;
    font-size: 22px;
    .keyword {
      font-size: 36px;
      font-weight: bold;
      margin-right: 8px;
      line-height: normal;
    }
    .n-text {
      display: inline-block;
    }
    .channel-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-left: 6px;
      padding: 0;
      vertical-align: middle;
      border: none;
      border-radius: 50%;
      background: rgba(var(--primary), 0.08);
      color: rgba(var(--primary), 0.75);
      cursor: pointer;
      transition:
        background-color 0.2s,
        color 0.2s;
      &:hover {
        background: rgba(var(--primary), 0.16);
        color: rgb(var(--primary));
      }
      &.active {
        background: rgba(var(--primary), 0.2);
        color: rgb(var(--primary));
      }
    }
  }
  .router-view {
    flex: 1;
    overflow: hidden;
  }
}
</style>
