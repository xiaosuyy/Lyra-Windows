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
    <!-- 导入 / 同步歌单账号选择 -->
    <n-modal
      v-model:show="pickerShow"
      preset="card"
      style="width: 420px"
      :mask-closable="!actionRunning"
      :closable="!actionRunning"
    >
      <template #header>
        {{ pickerMode === "import" ? "从哪个平台导入？" : "同步到哪个平台？" }}
      </template>
      <div class="picker-body">
        <n-text v-if="accounts.length === 0" depth="3" class="picker-empty">
          还没有登录账号，请先在设置中登录网易云音乐或 QQ 音乐
        </n-text>
        <n-flex v-else vertical :size="8">
          <div
            v-for="account in accounts"
            :key="account.channelId"
            class="account"
            :class="{ selected: selectedChannels.includes(account.channelId) }"
            @click="toggleChannel(account.channelId)"
          >
            <n-avatar round :size="40" :src="account.avatarUrl">
              <SvgIcon :name="account.channelId === 'netease' ? 'Music' : 'Cloud'" />
            </n-avatar>
            <div class="account-info">
              <n-text class="name">{{ account.displayName }}</n-text>
              <n-text class="channel" depth="3">
                {{ favoritesChannelLabel(account.channelId) }}
              </n-text>
            </div>
            <div class="account-check" @click.stop>
              <n-checkbox
                :checked="selectedChannels.includes(account.channelId)"
                @update:checked="toggleChannel(account.channelId)"
              />
            </div>
          </div>
        </n-flex>
      </div>
      <template #footer>
        <n-flex justify="end" :size="12">
          <n-button :disabled="actionRunning" @click="pickerShow = false">取消</n-button>
          <n-button
            type="primary"
            :loading="actionRunning"
            :disabled="selectedChannels.length === 0"
            @click="confirmFavoritesAction"
          >
            {{ pickerMode === "import" ? "导入" : "同步" }}
          </n-button>
        </n-flex>
      </template>
    </n-modal>
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
import {
  favoritesChannelLabel,
  getFavoritesChannelAccounts,
  hasFavoritesError,
  runFavoritesAction,
  summarizeFavoritesResults,
  type FavoritesActionMode,
  type FavoritesChannel,
  type FavoritesChannelAccount,
} from "@/utils/favorites";

const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();

const { isSmall } = useMobile();

const likeType = ref<string>((router.currentRoute.value?.name as string) || "like-playlists");

// 导入 / 同步歌单
const pickerShow = ref<boolean>(false);
const pickerMode = ref<FavoritesActionMode>("import");
const actionRunning = ref<boolean>(false);
const accounts = ref<FavoritesChannelAccount[]>([]);
const selectedChannels = ref<FavoritesChannel[]>([]);

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

const openFavoritesPicker = (mode: FavoritesActionMode) => {
  pickerMode.value = mode;
  accounts.value = getFavoritesChannelAccounts();
  selectedChannels.value = accounts.value.map((account) => account.channelId);
  pickerShow.value = true;
};

const toggleChannel = (channelId: FavoritesChannel) => {
  const index = selectedChannels.value.indexOf(channelId);
  if (index === -1) selectedChannels.value.push(channelId);
  else selectedChannels.value.splice(index, 1);
};

const confirmFavoritesAction = async () => {
  if (actionRunning.value || selectedChannels.value.length === 0) return;
  const mode = pickerMode.value;
  // 与手机端一致：本地收藏为空时不允许同步（缓存未加载时以收藏 ID 为准）
  const snapshotCount = (dataStore.likeSongsList.data || []).length;
  const likedCount = (dataStore.userLikeData.songs || []).length;
  if (mode === "sync" && snapshotCount === 0 && likedCount === 0) {
    window.$message.warning("我喜欢的音乐为空，没有可同步的歌曲");
    return;
  }
  const channels = [...selectedChannels.value];
  pickerShow.value = false;
  actionRunning.value = true;
  try {
    const results = await runFavoritesAction(mode, channels);
    const message = summarizeFavoritesResults(results, mode);
    if (hasFavoritesError(results)) window.$message.warning(message);
    else window.$message.success(message);
  } finally {
    actionRunning.value = false;
  }
};

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
