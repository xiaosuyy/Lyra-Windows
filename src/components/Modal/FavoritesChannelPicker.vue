<template>
  <div class="favorites-picker">
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
          <n-text class="channel" depth="3">{{ favoritesChannelLabel(account.channelId) }}</n-text>
        </div>
        <div class="account-check" @click.stop>
          <n-checkbox
            :checked="selectedChannels.includes(account.channelId)"
            @update:checked="toggleChannel(account.channelId)"
          />
        </div>
      </div>
    </n-flex>
    <n-flex justify="end" :size="12" class="picker-footer">
      <n-button :disabled="running" @click="emit('close')">取消</n-button>
      <n-button
        type="primary"
        :loading="running"
        :disabled="selectedChannels.length === 0"
        @click="confirm"
      >
        {{ mode === "import" ? "导入" : "同步" }}
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type {
  FavoritesActionMode,
  FavoritesChannel,
  FavoritesChannelAccount,
} from "@/utils/favorites";
import {
  favoritesChannelLabel,
  getFavoritesChannelAccounts,
  hasFavoritesError,
  runFavoritesAction,
  summarizeFavoritesResults,
} from "@/utils/favorites";
import { useDataStore } from "@/stores";

const props = defineProps<{ mode: FavoritesActionMode }>();
const emit = defineEmits<{
  (e: "close"): void;
}>();

const dataStore = useDataStore();
const accounts = ref<FavoritesChannelAccount[]>([]);
const selectedChannels = ref<FavoritesChannel[]>([]);
const running = ref<boolean>(false);

onMounted(() => {
  accounts.value = getFavoritesChannelAccounts();
  selectedChannels.value = accounts.value.map((account) => account.channelId);
});

const toggleChannel = (channelId: FavoritesChannel) => {
  const index = selectedChannels.value.indexOf(channelId);
  if (index === -1) selectedChannels.value.push(channelId);
  else selectedChannels.value.splice(index, 1);
};

const confirm = async () => {
  if (running.value || selectedChannels.value.length === 0) return;
  const mode = props.mode;
  // 与手机端一致：本地收藏为空时不允许同步
  const snapshotCount = (dataStore.likeSongsList.data || []).length;
  const likedCount = (dataStore.userLikeData.songs || []).length;
  if (mode === "sync" && snapshotCount === 0 && likedCount === 0) {
    window.$message.warning("我喜欢的音乐为空，没有可同步的歌曲");
    return;
  }
  running.value = true;
  try {
    const results = await runFavoritesAction(mode, [...selectedChannels.value]);
    const message = summarizeFavoritesResults(results, mode);
    if (hasFavoritesError(results)) window.$message.warning(message);
    else window.$message.success(message);
    emit("close");
  } finally {
    running.value = false;
  }
};
</script>

<style lang="scss" scoped>
.favorites-picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
</style>
