<template>
  <div class="lyra-home">
    <!-- 顶部问候与音源切换 -->
    <header class="home-hero">
      <div class="hero-copy">
        <n-h1>{{ greeting }}</n-h1>
        <n-text depth="3" class="subtitle">{{ subtitle }}</n-text>
      </div>
      <n-flex class="hero-actions" align="center" :size="12">
        <n-button quaternary circle :loading="loading" @click="loadHome">
          <template #icon>
            <SvgIcon name="Refresh" :size="20" />
          </template>
        </n-button>
      </n-flex>
    </header>

    <!-- 首行快捷卡片（对齐 Lyra 手机端首页） -->
    <div class="quick-scroll">
      <div class="quick-row">
        <div
          v-for="(card, index) in quickCards"
          :key="card.key"
          role="button"
          tabindex="0"
          class="quick-entry"
          :style="{ animationDelay: `${index * 45}ms` }"
          @click="card.onClick"
          @keydown.enter="card.onClick"
        >
          <span class="quick-eyebrow">{{ card.eyebrow }}</span>
          <div class="quick-title-row">
            <span class="quick-title">{{ card.title }}</span>
            <button
              v-if="card.radar"
              type="button"
              :class="['quick-chevron', { open: radarExpanded }]"
              @click.stop="radarExpanded = !radarExpanded"
            >
              <SvgIcon name="Down" :size="18" />
            </button>
          </div>
          <span class="quick-subtitle">{{ card.subtitle }}</span>
          <div v-if="card.radar" v-show="radarExpanded" class="quick-radar-modes" @click.stop>
            <button
              v-for="mode in RADAR_MODES"
              :key="mode.value"
              type="button"
              :class="['quick-radar-mode', { active: settingStore.qqRadarMode === mode.value }]"
              @click.stop="selectRadarMode(mode.value)"
            >
              {{ mode.label }}
            </button>
          </div>
          <span class="quick-art" :style="{ background: card.gradient }">
            <SvgIcon class="quick-watermark" :name="card.icon" :size="76" />
            <span class="quick-art-title">{{ card.title }}</span>
          </span>
        </div>
      </div>
    </div>

    <template v-if="settingStore.useOnlineService">
      <!-- 加载骨架 -->
      <template v-if="loading">
        <section v-for="i in 3" :key="i" class="rail-section">
          <div class="rail-head">
            <n-skeleton text style="width: 120px; height: 24px" />
          </div>
          <div class="rail-skeleton">
            <div v-for="j in 6" :key="j" class="skeleton-card">
              <n-skeleton height="164px" :style="{ borderRadius: '18px' }" />
              <n-skeleton text style="margin-top: 12px; width: 82%" />
              <n-skeleton text style="margin-top: 6px; width: 52%" />
            </div>
          </div>
        </section>
      </template>
      <!-- 内容 -->
      <template v-else>
        <section v-for="section in visibleSections" :key="section.key" class="rail-section">
          <div class="rail-head">
            <div class="rail-title">
              <h2>{{ section.title }}</h2>
              <span v-if="section.tip" class="rail-tip">{{ section.tip }}</span>
            </div>
            <button v-if="section.more" type="button" class="rail-more" @click="section.more">
              查看全部
              <SvgIcon name="Right" :size="16" />
            </button>
          </div>
          <n-scrollbar x-scrollable class="rail-scroll">
            <div class="rail">
              <template v-if="section.kind === 'cover'">
                <div
                  v-for="item in coverItems(section)"
                  :key="`${section.key}-${item.id}`"
                  class="media-card"
                  @click="openCover(section, item)"
                >
                  <div class="media-cover">
                    <s-image
                      :src="item.coverSize?.m || item.cover"
                      default-src="/images/album.jpg?asset"
                      class="media-img"
                      once
                    />
                    <div v-if="item.playCount" class="play-count">
                      <SvgIcon name="Play" :size="13" />
                      <span>{{ formatNumber(item.playCount) }}</span>
                    </div>
                  </div>
                  <span class="media-name">{{ item.name }}</span>
                  <span v-if="item.creator?.name" class="media-sub">{{ item.creator.name }}</span>
                  <span v-else-if="item.count" class="media-sub">{{ item.count }} 首</span>
                </div>
              </template>
              <template v-else>
                <div
                  v-for="(song, index) in songItems(section)"
                  :key="`${section.key}-${song.id}-${index}`"
                  class="media-card song"
                  @click="playSong(section, song)"
                >
                  <div class="media-cover">
                    <s-image
                      :src="song.cover"
                      default-src="/images/album.jpg?asset"
                      class="media-img"
                      once
                    />
                    <div class="song-play">
                      <SvgIcon name="Play" :size="24" />
                    </div>
                  </div>
                  <span class="media-name">{{ song.name }}</span>
                  <span class="media-sub">{{ artistsName(song) }}</span>
                </div>
              </template>
            </div>
          </n-scrollbar>
        </section>
        <n-empty
          v-if="visibleSections.length === 0"
          :description="emptyDescription"
          size="large"
          style="margin-top: 60px"
        >
          <template #icon>
            <SvgIcon name="SearchOff" />
          </template>
        </n-empty>
      </template>
    </template>
    <!-- 本地模式 -->
    <HomeLocal v-else />
  </div>
</template>

<script setup lang="ts">
import type { CoverType, SongType } from "@/types/main";
import { useAccountStore, useDataStore, useSettingStore } from "@/stores";
import { getGreeting } from "@/utils/time";
import { isLogin } from "@/utils/auth";
import { formatCoverList, formatSongsList } from "@/utils/format";
import { newAlbumsAll, newSongs, personalized, radarPlaylist } from "@/api/rec";
import { radioRecommend } from "@/api/radio";
import { topPlaylist } from "@/api/playlist";
import { qqMusicHome } from "@/api/qqmusic";
import { formatQQPlaylists, formatQQSongs } from "@/utils/qq";
import { formatNumber } from "@/utils/helper";
import { openSetting } from "@/utils/modal";
import { usePlayerController } from "@/core/player/PlayerController";
import HomeLocal from "./HomeLocal.vue";

interface HomeSection {
  key: string;
  title: string;
  tip?: string;
  kind: "cover" | "song";
  target?: "playlist" | "album" | "radio" | "toplist";
  items: CoverType[] | SongType[];
  more?: () => void;
}

const router = useRouter();
const dataStore = useDataStore();
const settingStore = useSettingStore();
const accountStore = useAccountStore();
const player = usePlayerController();

interface QuickCard {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: string;
  gradient: string;
  radar?: boolean;
  onClick: () => void;
}

const RADAR_MODES = [
  { value: 3, label: "探索" },
  { value: 2, label: "默认" },
  { value: 1, label: "熟悉" },
] as const;

const RADAR_COPY: Record<number, { eyebrow: string; subtitle: string }> = {
  3: { eyebrow: "探索雷达", subtitle: "多听些没听过的歌" },
  2: { eyebrow: "为你挑选", subtitle: "根据你的收听口味持续更新" },
  1: { eyebrow: "熟悉口味", subtitle: "常听歌手与相似歌曲" },
};

const radarExpanded = ref(false);

const neteaseRadarCover = ref<CoverType>();
const qqRadarSongs = ref<SongType[]>([]);
const qqNewSongs = ref<SongType[]>([]);
const qqHotToplist = ref<CoverType>();

const loading = ref<boolean>(true);
const neSections = ref<HomeSection[]>([]);
const qqSections = ref<HomeSection[]>([]);
let requestId = 0;

const sections = computed<HomeSection[]>(() =>
  settingStore.homeSource === "tencent" ? qqSections.value : neSections.value,
);
const visibleSections = computed(() =>
  sections.value.filter((section) => section.items.length > 0),
);

const greeting = computed(() => {
  const base = getGreeting();
  const neteaseName = isLogin() ? dataStore.userData.name?.trim() : "";
  const qqName = accountStore.qqLoggedIn ? accountStore.qqDisplayName : "";
  // 优先展示当前首页音源对应的账号昵称
  const name =
    settingStore.homeSource === "tencent" ? qqName || neteaseName : neteaseName || qqName;
  return name ? `${base}，${name}` : base;
});

const subtitle = computed(() =>
  settingStore.homeSource === "tencent"
    ? accountStore.qqLoggedIn
      ? "QQ 音乐为你准备了今天的推荐"
      : "使用 QQ 音乐推荐，登录后可获得每日推荐"
    : isLogin()
      ? "开启今天的好心情"
      : "登录网易云音乐，解锁专属推荐",
);

const emptyDescription = computed(() =>
  settingStore.homeSource === "tencent"
    ? "QQ 音乐暂时没有返回内容，请稍后重试"
    : "推荐内容加载失败，请稍后重试",
);

const playCardSongs = (songs: SongType[], emptyTip: string) => {
  if (!songs.length) {
    window.$message.warning(emptyTip);
    return;
  }
  player.updatePlayList(songs, songs[0], 0);
};

const openNeteaseHot = () => {
  router.push({ name: "playlist", query: { id: 3778678 } });
};

const openNeteaseRadar = () => {
  if (!isLogin()) {
    window.$message.warning("请先登录网易云音乐");
    openSetting("account");
    return;
  }
  if (!neteaseRadarCover.value) {
    window.$message.warning("私人雷达暂时没有内容");
    return;
  }
  router.push({ name: "playlist", query: { id: neteaseRadarCover.value.id } });
};

const openQQHot = () => {
  const list = qqHotToplist.value;
  if (!list) {
    router.push({ name: "tencent-playlist", query: { kind: "toplists" } });
    return;
  }
  router.push({
    name: "tencent-playlist",
    query: { kind: "toplist", id: list.id, name: list.name, cover: list.cover },
  });
};

const openQQRadar = () => {
  if (!accountStore.qqLoggedIn) {
    window.$message.warning("雷达推荐需登录 QQ 音乐后使用");
    openSetting("account");
    return;
  }
  playCardSongs(qqRadarSongs.value, "雷达推荐暂无内容");
};

const loadQQRadar = async (mode: number) => {
  if (!accountStore.qqLoggedIn) {
    qqRadarSongs.value = [];
    return;
  }
  const result = await qqMusicHome("radar", 30, mode).catch(() => undefined);
  const songs = formatQQSongs(result?.data?.radar);
  if (songs.length) qqRadarSongs.value = songs;
};

const selectRadarMode = async (mode: number) => {
  if (mode !== settingStore.qqRadarMode) {
    settingStore.qqRadarMode = mode;
    await loadQQRadar(mode);
  }
  radarExpanded.value = false;
};

const quickCards = computed<QuickCard[]>(() => {
  if (settingStore.homeSource === "tencent") {
    const radarCopy = RADAR_COPY[settingStore.qqRadarMode] ?? RADAR_COPY[2];
    return [
      {
        key: "qq-radar",
        eyebrow: radarCopy.eyebrow,
        title: "雷达推荐",
        subtitle: radarCopy.subtitle,
        icon: "RssFeed",
        gradient: "linear-gradient(135deg, #6b7bff 0%, #8c52ff 100%)",
        radar: true,
        onClick: openQQRadar,
      },
      {
        key: "qq-hot",
        eyebrow: "全站热门",
        title: "热歌榜",
        subtitle: "大家都在听",
        icon: "Fire",
        gradient: "linear-gradient(135deg, #ffa14a 0%, #ff5a36 100%)",
        onClick: openQQHot,
      },
      {
        key: "qq-new",
        eyebrow: "每日上新",
        title: "新歌首发",
        subtitle: "新歌抢先听",
        icon: "Star",
        gradient: "linear-gradient(135deg, #59c173 0%, #26a69a 100%)",
        onClick: () => playCardSongs(qqNewSongs.value, "新歌首发暂无内容"),
      },
    ];
  }
  return [
    {
      key: "daily",
      eyebrow: "每日更新",
      title: "每日推荐",
      subtitle: "为你定制的歌曲",
      icon: "Calendar-Empty",
      gradient: "linear-gradient(135deg, #ff5b8a 0%, #ff3147 100%)",
      onClick: openDaily,
    },
    {
      key: "hot",
      eyebrow: "全站热门",
      title: "热歌榜",
      subtitle: "大家都在听",
      icon: "Fire",
      gradient: "linear-gradient(135deg, #ffa14a 0%, #ff5a36 100%)",
      onClick: openNeteaseHot,
    },
    {
      key: "heart",
      eyebrow: "为你心动",
      title: "心动模式",
      subtitle: "喜欢与惊喜交替播放",
      icon: "HeartBit",
      gradient: "linear-gradient(135deg, #ff6eac 0%, #9b5de5 100%)",
      onClick: () => player.toggleShuffle("heartbeat"),
    },
    {
      key: "radar",
      eyebrow: "私人雷达",
      title: "私人雷达",
      subtitle: "根据口味持续更新",
      icon: "RssFeed",
      gradient: "linear-gradient(135deg, #6b7bff 0%, #8c52ff 100%)",
      onClick: openNeteaseRadar,
    },
  ];
});

const coverItems = (section: HomeSection) => section.items as CoverType[];
const songItems = (section: HomeSection) => section.items as SongType[];

const artistsName = (song: SongType) => {
  if (Array.isArray(song.artists)) return song.artists.map((artist) => artist.name).join(" / ");
  return song.artists || "未知歌手";
};

// 打开每日推荐
const openDaily = () => {
  if (settingStore.homeSource === "tencent") {
    if (!accountStore.qqLoggedIn) {
      window.$message.warning("请先在设置中登录 QQ 音乐");
      openSetting("account");
      return;
    }
    router.push({ name: "tencent-playlist", query: { kind: "daily" } });
    return;
  }
  router.push({ name: "daily-songs" });
};

// 打开封面详情
const openCover = (section: HomeSection, item: CoverType) => {
  if (settingStore.homeSource === "tencent") {
    router.push({
      name: "tencent-playlist",
      query: {
        kind: section.target === "toplist" ? "toplist" : "playlist",
        id: item.id,
        name: item.name,
        cover: item.cover,
      },
    });
    return;
  }
  const routeName =
    section.target === "album" ? "album" : section.target === "radio" ? "radio" : "playlist";
  router.push({ name: routeName, query: { id: item.id } });
};

// 播放歌曲
const playSong = (section: HomeSection, song: SongType) => {
  player.updatePlayList(songItems(section), song, 0);
};

// 网易云推荐
const loadNetease = async (id: number) => {
  const [playlistRes, radarRes, songsRes, topRes, radioRes, albumRes] = await Promise.allSettled([
    personalized("playlist", isLogin() ? 21 : 20),
    radarPlaylist(),
    newSongs(0),
    topPlaylist(),
    radioRecommend(),
    newAlbumsAll("ALL", 12),
  ]);
  if (id !== requestId) return;

  const playlist = playlistRes.status === "fulfilled" ? playlistRes.value : undefined;
  const radar = radarRes.status === "fulfilled" ? radarRes.value : undefined;
  const songs = songsRes.status === "fulfilled" ? songsRes.value : undefined;
  const top = topRes.status === "fulfilled" ? topRes.value : undefined;
  const radio = radioRes.status === "fulfilled" ? radioRes.value : undefined;
  const album = albumRes.status === "fulfilled" ? albumRes.value : undefined;

  const topList = top?.list
    ? [
        ...top.list.filter((item: any) => item.ToplistType !== undefined),
        ...top.list.filter((item: any) => item.ToplistType === undefined),
      ].slice(0, 12)
    : [];

  const radarCovers = formatCoverList(radar ?? []);
  neteaseRadarCover.value = radarCovers[0];

  neSections.value = [
    {
      key: "recommend",
      title: "推荐歌单",
      kind: "cover",
      target: "playlist",
      items: formatCoverList(
        playlist?.result?.filter((item: any) => !String(item.name).includes("私人雷达")),
      ),
      more: () => router.push({ name: "discover-playlists" }),
    },
    {
      key: "radar",
      title: "雷达歌单",
      kind: "cover",
      target: "playlist",
      items: radarCovers,
      more: () => router.push({ name: "discover-playlists" }),
    },
    {
      key: "new-songs",
      title: "新歌速递",
      kind: "song",
      items: formatSongsList(songs?.data ?? []),
      more: () => router.push({ name: "discover-new", query: { type: 1 } }),
    },
    {
      key: "toplists",
      title: "排行榜",
      kind: "cover",
      target: "toplist",
      items: formatCoverList(topList),
      more: () => router.push({ name: "discover-toplists" }),
    },
    {
      key: "radio",
      title: "推荐播客",
      kind: "cover",
      target: "radio",
      items: formatCoverList(radio?.djRadios),
      more: () => router.push({ name: "radio-hot" }),
    },
    {
      key: "albums",
      title: "新碟上架",
      kind: "cover",
      target: "album",
      items: formatCoverList(album?.albums),
      more: () => router.push({ name: "discover-new" }),
    },
  ];
};

// QQ 音乐推荐
const loadTencent = async (id: number) => {
  const result = await qqMusicHome("all", 12, settingStore.qqRadarMode).catch(() => undefined);
  if (id !== requestId) return;
  const data = result?.data ?? {};
  const dailySongs = formatQQSongs(data.daily);
  const toplists = formatQQPlaylists(data.toplists);
  qqRadarSongs.value = accountStore.qqLoggedIn ? formatQQSongs(data.radar) : [];
  qqNewSongs.value = formatQQSongs(data.newSongs);
  qqHotToplist.value = toplists.find((item) => String(item.name).includes("热歌")) ?? toplists[0];

  qqSections.value = [
    {
      key: "qq-playlists",
      title: "推荐歌单",
      kind: "cover",
      target: "playlist",
      items: formatQQPlaylists(data.playlists),
    },
    {
      key: "qq-daily",
      title: "每日推荐",
      tip: dailySongs.length ? "根据你的口味生成" : undefined,
      kind: "song",
      items: dailySongs,
    },
    {
      key: "qq-new",
      title: "新歌速递",
      kind: "song",
      items: formatQQSongs(data.newSongs),
    },
    {
      key: "qq-toplists",
      title: "热门榜单",
      kind: "cover",
      target: "toplist",
      items: toplists,
      more: () => router.push({ name: "tencent-playlist", query: { kind: "toplists" } }),
    },
  ];
};

const loadHome = async () => {
  const id = ++requestId;
  loading.value = true;
  try {
    if (settingStore.homeSource === "tencent") await loadTencent(id);
    else await loadNetease(id);
  } catch (error) {
    console.error("获取首页推荐失败:", error);
  } finally {
    if (id === requestId) loading.value = false;
  }
};

watch(
  () => settingStore.homeSource,
  () => loadHome(),
);

onMounted(loadHome);
</script>

<style lang="scss" scoped>
.lyra-home {
  position: relative;
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
  padding-bottom: 40px;
  .home-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin: 14px 0 26px;
    .hero-copy {
      min-width: 0;
      .n-h1 {
        margin: 0;
        font-size: 34px;
        font-weight: 800;
        letter-spacing: -0.5px;
        line-height: 1.2;
      }
      .subtitle {
        display: block;
        margin-top: 6px;
        font-size: 14px;
      }
    }
    .hero-actions {
      flex-shrink: 0;
    }
  }
  .source-pill {
    display: flex;
    padding: 4px;
    border-radius: 999px;
    background-color: var(--surface-container-hex);
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 16px;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: var(--text-color-3);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition:
        color 0.3s,
        background-color 0.3s,
        box-shadow 0.3s,
        transform 0.2s;
      &:hover {
        color: var(--text-color-1);
      }
      &:active {
        transform: scale(0.97);
      }
      &.active {
        color: var(--primary-hex);
        background-color: var(--surface-color);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
      }
    }
  }
  .quick-scroll {
    margin-bottom: 34px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }
  }
  .quick-row {
    display: inline-flex;
    gap: 18px;
    padding: 2px 2px 10px;
    vertical-align: top;
  }
  .quick-entry {
    display: inline-flex;
    flex-direction: column;
    width: 300px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    animation: quick-rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    .quick-eyebrow {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: var(--text-color-3);
    }
    .quick-title-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .quick-chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text-color-3);
      cursor: pointer;
      transition: transform 0.22s ease;
      &:hover {
        color: var(--text-color-1);
      }
      &.open {
        transform: rotate(180deg);
      }
    }
    .quick-title {
      margin-top: 3px;
      font-size: 21px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text-color-1);
    }
    .quick-subtitle {
      margin-top: 2px;
      font-size: 13px;
      color: var(--text-color-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .quick-radar-modes {
      display: flex;
      gap: 3px;
      margin-top: 10px;
      padding: 3px;
      border-radius: 13px;
      background: rgba(128, 128, 128, 0.16);
    }
    .quick-radar-mode {
      flex: 1;
      height: 34px;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: var(--text-color-2);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition:
        background 0.2s ease,
        color 0.2s ease;
      &:hover {
        color: var(--text-color-1);
      }
      &.active {
        background: rgb(var(--primary));
        color: #fff;
      }
    }
    .quick-art {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      aspect-ratio: 1.48;
      margin-top: 8px;
      border-radius: 18px;
      overflow: hidden;
      transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
      &::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.18));
        pointer-events: none;
      }
      .quick-watermark {
        position: relative;
        z-index: 1;
        color: #fff;
        opacity: 0.24;
      }
      .quick-art-title {
        position: absolute;
        left: 18px;
        bottom: 14px;
        z-index: 2;
        font-size: 25px;
        font-weight: 800;
        letter-spacing: -0.3px;
        color: #fff;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
      }
    }
    &:hover .quick-art {
      transform: translateY(-4px);
    }
    &:active .quick-art {
      transform: translateY(-1px) scale(0.995);
    }
  }
  @keyframes quick-rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .rail-section {
    margin-bottom: 30px;
    .rail-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      padding: 0 2px;
      .rail-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
        h2 {
          margin: 0;
          font-size: 21px;
          font-weight: 700;
          letter-spacing: -0.3px;
        }
        .rail-tip {
          font-size: 12px;
          color: var(--text-color-3);
          white-space: nowrap;
        }
      }
      .rail-more {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 6px 10px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--text-color-3);
        font-size: 13px;
        cursor: pointer;
        transition:
          color 0.3s,
          background-color 0.3s;
        &:hover {
          color: var(--primary-hex);
          background-color: rgba(var(--primary), 0.1);
        }
      }
    }
    .rail-scroll {
      overflow: hidden;
    }
    .rail {
      display: inline-flex;
      gap: 18px;
      padding: 2px 2px 8px;
      white-space: nowrap;
    }
    .media-card {
      display: inline-flex;
      flex-direction: column;
      width: 164px;
      flex-shrink: 0;
      cursor: pointer;
      .media-cover {
        position: relative;
        width: 164px;
        height: 164px;
        border-radius: 18px;
        overflow: hidden;
        background-color: var(--surface-container-hex);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
        transition:
          transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
          box-shadow 0.3s;
        .media-img {
          width: 100%;
          height: 100%;
          transition: transform 0.4s ease;
          :deep(img) {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        }
        .play-count {
          position: absolute;
          top: 8px;
          right: 10px;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        }
        .song-play {
          position: absolute;
          right: 10px;
          bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          color: #fff;
          background: rgba(255, 255, 255, 0.24);
          backdrop-filter: blur(6px);
          opacity: 0;
          transform: translateY(6px);
          transition:
            opacity 0.25s,
            transform 0.25s;
        }
      }
      .media-name {
        margin-top: 10px;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .media-sub {
        margin-top: 3px;
        font-size: 12px;
        color: var(--text-color-3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      &:hover {
        .media-cover {
          transform: translateY(-4px);
          box-shadow: 0 16px 30px rgba(0, 0, 0, 0.18);
          .media-img {
            transform: scale(1.06);
          }
        }
        .song-play {
          opacity: 1;
          transform: translateY(0);
        }
      }
    }
    .rail-skeleton {
      display: flex;
      gap: 18px;
      overflow: hidden;
      .skeleton-card {
        width: 164px;
        flex-shrink: 0;
      }
    }
  }
  @media (max-width: 700px) {
    .home-hero {
      flex-direction: column;
      align-items: flex-start;
    }
    .quick-entry {
      width: 250px;
    }
  }
}
</style>
