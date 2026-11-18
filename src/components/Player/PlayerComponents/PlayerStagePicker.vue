<template>
  <n-modal
    v-model:show="show"
    preset="card"
    class="stage-picker"
    :bordered="false"
    :mask-closable="true"
    :style="{ width: '760px', maxWidth: '92vw' }"
  >
    <template #header>
      <div class="stage-picker__header">
        <span class="stage-picker__title">播放形态</span>
        <n-input
          v-model:value="keyword"
          class="stage-picker__search"
          size="small"
          placeholder="搜索形态名称或说明"
          clearable
        />
      </div>
    </template>
    <div class="stage-picker__grid">
      <button
        v-for="item in filteredStages"
        :key="item.id"
        :class="['stage-card', { active: item.id === activeStageId }]"
        @click="choose(item)"
      >
        <span class="stage-card__badge" v-if="item.id === activeStageId">使用中</span>
        <span class="stage-card__name">{{ item.name }}</span>
        <span class="stage-card__desc">{{ item.desc }}</span>
      </button>
      <div v-if="!filteredStages.length" class="stage-picker__empty">没有匹配的形态</div>
    </div>
    <template #footer>
      <div class="stage-picker__footer">
        <span>内置播放器模式与设置中的播放器样式互通，形态页内按 F5 可调整参数</span>
        <n-button size="tiny" quaternary :disabled="!keyword" @click="keyword = ''">
          清空搜索
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { PLAYER_STAGES, type PlayerStageItem } from "@/constants/stages";
import { usePlayerStage } from "@/composables/usePlayerStage";
import { useSettingStore } from "@/stores";

const show = defineModel<boolean>("show", { default: false });

const settingStore = useSettingStore();
const { currentStageId, setStage } = usePlayerStage();

/** 内置播放器三个模式的选中态跟随设置里的播放器样式 */
const activeStageId = computed(() => {
  const stage = PLAYER_STAGES.find((item) => item.id === currentStageId.value);
  return stage && !stage.file ? `classic-${settingStore.playerType}` : currentStageId.value;
});

const keyword = ref("");

const filteredStages = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return PLAYER_STAGES;
  return PLAYER_STAGES.filter((item) =>
    `${item.name} ${item.desc} ${item.id}`.toLowerCase().includes(query),
  );
});

const choose = (item: PlayerStageItem) => {
  if (item.playerType) settingStore.playerType = item.playerType;
  setStage(item.id);
  show.value = false;
};
</script>

<style lang="scss">
/* 弹窗根节点由 Naive UI 渲染，scoped 样式挂不上去；
   frosted-glass 主题会用 !important 把弹窗刷成浅色玻璃，这里用更高优先级还原深色 */
.n-modal.stage-picker.n-card,
:root.frosted-glass .n-modal.stage-picker.n-card {
  --n-color: rgba(24, 24, 28, 0.94);
  --n-text-color: rgba(236, 236, 240, 0.92);
  --n-title-text-color: #f4f4f6;
  --n-close-icon-color: rgba(255, 255, 255, 0.55);
  --n-close-icon-color-hover: rgba(255, 255, 255, 0.9);
  --n-close-icon-color-pressed: #fff;
  --n-border-radius: 16px;
  background-color: rgba(24, 24, 28, 0.94) !important;
  backdrop-filter: blur(24px) saturate(1.2);
  overflow: hidden;
  .n-card-header {
    padding: 18px 22px 6px;
  }
  .n-card__content {
    padding: 8px 22px 14px;
  }
  .n-card__footer {
    padding: 0 22px 16px;
  }
}

.stage-picker__search.n-input {
  max-width: 260px;
  --n-color: rgba(255, 255, 255, 0.08);
  --n-color-focus: rgba(255, 255, 255, 0.12);
  --n-text-color: #f0f0f2;
  --n-placeholder-color: rgba(255, 255, 255, 0.35);
  --n-caret-color: #fff;
  --n-border: 1px solid rgba(255, 255, 255, 0.12);
  --n-border-hover: 1px solid rgba(255, 255, 255, 0.24);
  --n-border-focus: 1px solid rgba(var(--main-cover-color), 0.55);
  --n-box-shadow-focus: 0 0 0 2px rgba(var(--main-cover-color), 0.14);
  --n-clear-color: rgba(255, 255, 255, 0.45);
}
</style>

<style lang="scss" scoped>
.stage-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
  .stage-picker__title {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #f4f4f6;
    white-space: nowrap;
  }
}

.stage-picker__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: min(58vh, 560px);
  overflow-y: auto;
  padding-right: 4px;
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
  }
}

.stage-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.045);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    transform 0.2s;
  &:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
  }
  &.active {
    border-color: rgba(var(--main-cover-color), 0.55);
    background: rgba(var(--main-cover-color), 0.14);
  }
  .stage-card__name {
    font-size: 14px;
    font-weight: 600;
    color: #f2f2f4;
  }
  .stage-card__desc {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.55);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .stage-card__badge {
    position: absolute;
    top: 10px;
    right: 12px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    color: rgb(var(--main-cover-color));
    background: rgba(var(--main-cover-color), 0.16);
  }
}

.stage-picker__empty {
  grid-column: 1 / -1;
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}

.stage-picker__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
}
</style>
