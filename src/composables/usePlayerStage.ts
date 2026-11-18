import {
  DEFAULT_PLAYER_STAGE,
  PLAYER_STAGES,
  findPlayerStage,
  type PlayerStageItem,
} from "@/constants/stages";

const STORAGE_KEY = "lyra.player.stage";

const readSaved = (): string => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && findPlayerStage(saved)) return saved;
  } catch {
    // 隐私模式 / 无 localStorage
  }
  return DEFAULT_PLAYER_STAGE;
};

const currentStageId = ref<string>(readSaved());

/** 当前形态（找不到时回退默认的封面模式） */
const currentStage = computed<PlayerStageItem>(
  () => findPlayerStage(currentStageId.value) || PLAYER_STAGES[0],
);

/** 是否处于形态页模式（内置播放器模式不是） */
const isStageMode = computed<boolean>(() => !!currentStage.value.file);

/** 形态页地址（相对 AppServer 静态目录） */
const stageUrl = computed<string>(() =>
  currentStage.value.file ? `/player-stages/${currentStage.value.file}` : "",
);

const setStage = (id: string) => {
  if (!findPlayerStage(id)) return;
  currentStageId.value = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式 / 无 localStorage
  }
};

/** 播放形态选择（跨组件共享） */
export const usePlayerStage = () => ({
  currentStageId,
  currentStage,
  isStageMode,
  stageUrl,
  setStage,
});
