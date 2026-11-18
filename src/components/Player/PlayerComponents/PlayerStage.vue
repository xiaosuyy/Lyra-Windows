<template>
  <Transition name="stage-fade">
    <div v-if="stageUrl" :key="stageUrl" class="player-stage">
      <iframe
        ref="frameRef"
        :src="stageUrl"
        class="stage-frame"
        title="播放形态"
        allow="autoplay"
        @load="onFrameLoad"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { usePlayerStage } from "@/composables/usePlayerStage";
import { usePlayerController } from "@/core/player/PlayerController";
import { useMusicStore, useStatusStore } from "@/stores";
import { isElectron } from "@/utils/env";

const emit = defineEmits<{
  activity: [];
  space: [];
}>();

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const player = usePlayerController();
const { stageUrl } = usePlayerStage();

const frameRef = ref<HTMLIFrameElement | null>(null);
const ready = ref(false);
const coverUrl = ref("");

/** 本地歌曲封面无法从 http 页面直接读取，转成 data URL 交给形态页 */
const resolveCover = async () => {
  const song = musicStore.playSong;
  if (!song.id) {
    coverUrl.value = "";
    return;
  }
  if (song.path && isElectron) {
    try {
      const data = await window.electron.ipcRenderer.invoke("get-music-cover", song.path);
      if (data?.data) {
        const blob = new Blob([data.data], { type: data.format || "image/jpeg" });
        coverUrl.value = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.onabort = reject;
          reader.readAsDataURL(blob);
        });
        return;
      }
    } catch {
      // 读取封面失败时退回普通封面地址
    }
  }
  coverUrl.value = musicStore.getSongCover("xl") || "";
};

const artistsText = computed(() => {
  const artists = musicStore.playSong.artists;
  if (Array.isArray(artists)) return artists.map((item) => item.name).join(" / ");
  return artists || "";
});

const albumText = computed(() => {
  const album = musicStore.playSong.album;
  return typeof album === "string" ? album : album?.name || "";
});

/** 形态页歌词时间轴：优先逐字歌词，单位为秒 */
const lines = computed(() => {
  const yrc = musicStore.isHasYrc ? musicStore.songLyric.yrcData : [];
  const data = yrc.length ? yrc : musicStore.songLyric.lrcData;
  return data
    .map((line, index) => {
      const next = data[index + 1];
      const t = line.startTime / 1000;
      const end = next ? next.startTime / 1000 : line.endTime ? line.endTime / 1000 : t + 6;
      const words = line.words || [];
      const text = words.map((word) => word.word).join("") || line.words?.[0]?.word || "";
      return {
        t,
        dur: Math.max(0.4, end - t),
        text,
        chars: yrc.length
          ? words.map((word) => ({ c: word.word, t: word.startTime / 1000 }))
          : null,
      };
    })
    .filter((line) => line.text);
});

const accent = computed<number[]>(() => {
  const rgb = statusStore.mainColor.split(",").map((item) => Number(item.trim()));
  return rgb.length === 3 && rgb.every((item) => Number.isFinite(item)) ? rgb : [150, 165, 255];
});

const initSignature = computed(() =>
  [
    musicStore.playSong.id,
    coverUrl.value,
    lines.value.length,
    lines.value[0]?.t ?? 0,
    lines.value[lines.value.length - 1]?.t ?? 0,
    accent.value.join(","),
  ].join("|"),
);

const post = (type: string, payload?: unknown) => {
  const frame = frameRef.value;
  if (!frame?.contentWindow) return;
  try {
    frame.contentWindow.postMessage({ __c100: 1, type, payload }, window.location.origin);
  } catch {
    // iframe 已切换时忽略
  }
};

let lastInitSig = "";
const pushInit = (force = false) => {
  if (!ready.value) return;
  const sig = initSignature.value;
  if (!force && sig === lastInitSig) return;
  lastInitSig = sig;
  post("init", {
    song: {
      id: musicStore.playSong.id,
      name: musicStore.playSong.name,
      album: albumText.value,
      artists: artistsText.value,
      cover: coverUrl.value,
    },
    accent: accent.value,
    lines: lines.value,
    duration: player.getDuration() / 1000 || 0,
  });
};

/** 指针静止时把 iframe 内的光标也藏起来，和宿主保持一致 */
let cursorStyle: HTMLStyleElement | null = null;
const applyCursor = (hidden: boolean) => {
  const doc = frameRef.value?.contentDocument;
  if (!doc) return;
  if (hidden) {
    if (cursorStyle?.parentNode) return;
    cursorStyle = doc.createElement("style");
    cursorStyle.setAttribute("data-lyra-cursor", "none");
    cursorStyle.textContent = "html, body, * { cursor: none !important; }";
    (doc.head || doc.documentElement).appendChild(cursorStyle);
  } else if (cursorStyle) {
    cursorStyle.remove();
    cursorStyle = null;
  }
};

const onMessage = (event: MessageEvent) => {
  if (!frameRef.value || event.source !== frameRef.value.contentWindow) return;
  const data = event.data;
  if (!data || data.__c100 !== 1) return;
  if (data.type === "ready") {
    clearReadyTimer();
    ready.value = true;
    pushInit(true);
    applyCursor(!statusStore.playerMetaShow);
  } else if (data.type === "activity") {
    emit("activity");
  } else if (data.type === "key" && data.payload?.key === "Space") {
    emit("space");
  } else if (data.type === "error") {
    console.warn("[stage]", data.payload);
  }
};

let readyTimer = 0;
const clearReadyTimer = () => {
  if (readyTimer) window.clearTimeout(readyTimer);
  readyTimer = 0;
};

/** 个别形态可能来不及发 ready，加载后兜底初始化 */
const onFrameLoad = () => {
  ready.value = false;
  clearReadyTimer();
  readyTimer = window.setTimeout(() => {
    if (!ready.value) {
      ready.value = true;
      pushInit(true);
    }
  }, 1500);
};

let tickTimer = 0;
let liveAt = 0;
let lastBeatAt = 0;
let beatCount = 0;
let beatInterval = 500;
let prevSpectrum: Uint8Array | null = null;
let fluxAvg = 0;

const average = (data: Uint8Array, from: number, to: number) => {
  const end = Math.min(to, data.length);
  if (end <= from) return 0;
  let sum = 0;
  for (let i = from; i < end; i++) sum += data[i];
  return sum / (end - from) / 255;
};

/** 用频谱通量检测节拍，低频音量只作为强度参考 */
const pumpAudio = () => {
  if (!statusStore.playStatus) return;
  const data = player.getSpectrumData();
  if (!data || !data.length) return;

  const bass = average(data, 0, 6);
  const mid = average(data, 6, 40);
  const treble = average(data, 40, 120);
  let flux = 0;
  if (prevSpectrum && prevSpectrum.length === data.length) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += Math.max(0, data[i] - prevSpectrum[i]);
    flux = sum / data.length / 255;
  }
  prevSpectrum = data.slice();
  fluxAvg = fluxAvg * 0.9 + flux * 0.1;

  const now = performance.now();
  if (flux > 0.004 && flux > fluxAvg * 1.15 && now - lastBeatAt > 180) {
    if (lastBeatAt) {
      const interval = now - lastBeatAt;
      if (interval < 1500) beatInterval = beatInterval * 0.7 + interval * 0.3;
    }
    lastBeatAt = now;
    post("beat", { index: beatCount++, level: Math.min(1, 0.35 + flux * 12) });
  }

  if (now - liveAt >= 120) {
    liveAt = now;
    post("live", {
      bpm: Math.round(60000 / beatInterval),
      level: Math.min(1, bass * 0.6 + mid * 0.3 + treble * 0.1),
      bass,
      mid,
      treble,
      playing: statusStore.playStatus,
    });
  }
};

const startTick = () => {
  stopTick();
  tickTimer = window.setInterval(() => {
    if (!ready.value) return;
    post("tick", { time: player.getSeek() / 1000, playing: statusStore.playStatus });
    pumpAudio();
  }, 66);
};

const stopTick = () => {
  if (tickTimer) window.clearInterval(tickTimer);
  tickTimer = 0;
};

watch(initSignature, () => pushInit());
watch(coverUrl, () => pushInit());
watch(stageUrl, () => {
  ready.value = false;
  lastInitSig = "";
  clearReadyTimer();
  cursorStyle?.remove();
  cursorStyle = null;
});
watch(
  () => statusStore.playerMetaShow,
  (show) => applyCursor(!show),
);

watch(
  () => musicStore.playSong.id,
  () => {
    coverUrl.value = "";
    void resolveCover();
  },
);

onMounted(async () => {
  window.addEventListener("message", onMessage);
  startTick();
  await resolveCover();
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  stopTick();
  cursorStyle?.remove();
  cursorStyle = null;
  ready.value = false;
});
</script>

<style lang="scss" scoped>
.player-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #000;
  z-index: 0;
  .stage-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
}

.stage-fade-enter-active {
  transition: opacity 0.5s ease;
}
.stage-fade-enter-from {
  opacity: 0;
}
.stage-fade-leave-active {
  transition: opacity 0.2s ease;
}
.stage-fade-leave-to {
  opacity: 0;
}
</style>
