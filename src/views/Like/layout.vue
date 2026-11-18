<template>
  <div class="like">
    <div class="title">
      <n-text class="keyword">我的收藏</n-text>
      <n-flex v-if="dataStore.loginType !== 'uid'" class="status">
        <div
          v-for="(item, index) in likeData"
          :key="index"
          class="item"
          @click="router.push({ name: item.name })"
        >
          <SvgIcon :name="item.icon" :depth="3" />
          <n-number-animation :from="0" :to="item.length" />
        </div>
      </n-flex>
      <!-- 更多：导入 / 同步歌单 -->
      <div class="more-action">
        <n-dropdown :options="favoritesOptions" trigger="click" placement="bottom-end">
          <n-button :focusable="false" circle strong secondary>
            <template #icon>
              <SvgIcon name="More" />
            </template>
          </n-button>
        </n-dropdown>
      </div>
    </div>
    <!-- 标签页 -->
    <n-tabs
      v-if="dataStore.loginType !== 'uid'"
      v-model:value="likeType"
      :type="isSmall ? 'line' : 'segment'"
      class="tabs"
      justify-content="space-evenly"
      @update:value="(name: string) => router.push({ name })"
    >
      <n-tab name="like-playlists"> 歌单 </n-tab>
      <n-tab name="like-artists"> 艺人 </n-tab>
    </n-tabs>
    <!-- 路由 -->
    <RouterView v-slot="{ Component }">
      <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
        <KeepAlive v-if="settingStore.useKeepAlive">
          <component :is="Component" class="router-view" />
        </KeepAlive>
        <component v-else :is="Component" class="router-view" />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from "naive-ui";
import { useMobile } from "@/composables/useMobile";
import { useDataStore, useSettingStore } from "@/stores";
import { renderIcon } from "@/utils/helper";
import { openFavoritesPicker } from "@/utils/modal";

const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();

const { isSmall } = useMobile();

const likeType = ref<string>((router.currentRoute.value?.name as string) || "like-playlists");

// 导入 / 同步歌单
const favoritesOptions = computed<DropdownOption[]>(() => [
  {
    label: "导入歌单",
    key: "import",
    icon: renderIcon("Download"),
    props: { onClick: () => openFavoritesPicker("import") },
  },
  {
    label: "同步歌单",
    key: "sync",
    icon: renderIcon("Update"),
    props: { onClick: () => openFavoritesPicker("sync") },
  },
]);

// 喜欢数据
const likeData = computed(() => [
  {
    icon: "MusicList",
    name: "like-playlists",
    length: dataStore.userLikeData.playlists?.length || 0,
  },
  {
    icon: "Artist",
    name: "like-artists",
    length: dataStore.userLikeData.artists?.length || 0,
  },
]);

// 监听路由变化
watch(
  () => router.currentRoute.value.name,
  (val) => {
    if (val && (val as string).startsWith("like-")) {
      likeType.value = val as string;
    }
  },
);
</script>

<style lang="scss" scoped>
.like {
  display: flex;
  flex-direction: column;
  .title {
    display: flex;
    align-items: flex-end;
    line-height: normal;
    margin-top: 12px;
    margin-bottom: 20px;
    height: 40px;
    .keyword {
      font-size: 30px;
      font-weight: bold;
      margin-right: 12px;
      line-height: normal;
    }
    .status {
      font-size: 15px;
      font-weight: normal;
      line-height: 30px;
      .item {
        display: flex;
        align-items: center;
        opacity: 0.9;
        cursor: pointer;
        .n-icon {
          margin-right: 4px;
        }
      }
    }
    .more-action {
      display: flex;
      align-items: center;
      margin-left: auto;
    }
  }
  .picker-body {
    max-height: 320px;
    overflow-y: auto;
    .picker-empty {
      display: block;
      line-height: 1.7;
      padding: 6px 0;
    }
    .account {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background-color: var(--surface-container-hex);
      cursor: pointer;
      transition: background-color 0.15s;
      &.selected {
        background-color: rgba(var(--primary), 0.12);
      }
      .account-info {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        .name {
          font-size: 15px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .channel {
          font-size: 12px;
          line-height: 18px;
        }
      }
      .account-check {
        display: flex;
        align-items: center;
      }
    }
  }
  // 512px
  @media (max-width: 512px) {
    .status {
      display: none !important;
    }
  }
}
</style>
