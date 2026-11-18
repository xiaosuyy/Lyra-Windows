<template>
  <div
    :class="['player-data', settingStore.playerType, { center, light }]"
    :style="{ marginLeft: leftMargin }"
  >
    <!-- 名称 -->
    <div class="name">
      <span class="name-text text-hidden">
        {{
          settingStore.hideBracketedContent
            ? removeBrackets(musicStore.playSong.name)
            : musicStore.playSong.name || "未知曲目"
        }}
      </span>
      <!-- 额外信息 -->
      <n-flex
        v-if="statusStore.isUnlocked || musicStore.playSong.pc"
        class="extra-info"
        align="center"
      >
        <n-popover :show-arrow="false" placement="right" raw>
          <template #trigger>
            <SvgIcon
              :depth="3"
              :name="musicStore.playSong.pc ? 'Cloud' : 'CloudLockOpen'"
              size="22"
            />
          </template>
          <div class="player-tip">
            {{
              musicStore.playSong.pc
                ? "云盘歌曲，由用户上传"
                : "该歌曲暂时无法播放，为您采用其他音源，可能会与原曲存在差别"
            }}
          </div>
        </n-popover>
      </n-flex>
    </div>
    <!-- 别名 -->
    <span
      v-if="musicStore.playSong.alia && !settingStore.hideBracketedContent"
      class="alia text-hidden"
    >
      {{ musicStore.playSong.alia }}
    </span>
    <n-flex :align="center ? 'center' : undefined" size="small" vertical>
      <!-- 歌手 -->
      <div v-if="musicStore.playSong.type !== 'radio'" class="artists">
        <SvgIcon :depth="3" name="Artist" size="20" />
        <div v-if="Array.isArray(musicStore.playSong.artists)" class="ar-list">
          <span
            v-for="ar in musicStore.playSong.artists"
            :key="ar.id"
            class="ar"
            @click="jumpArtist(ar.id, ar.name)"
          >
            {{ settingStore.hideBracketedContent ? removeBrackets(ar.name) : ar.name }}
          </span>
        </div>
        <div v-else class="ar-list">
          <span class="ar" @click="jumpArtist()">{{
            settingStore.hideBracketedContent
              ? removeBrackets(musicStore.playSong.artists)
              : musicStore.playSong.artists || "未知艺术家"
          }}</span>
        </div>
      </div>
      <div v-else class="artists">
        <SvgIcon :depth="3" name="Artist" size="20" />
        <div class="ar-list">
          <span class="ar" @click="showCreatorTip">
            {{ musicStore.playSong.dj?.creator || "未知艺术家" }}
          </span>
        </div>
      </div>
      <!-- 电台 -->
      <div v-if="musicStore.playSong.type === 'radio'" class="dj" @click="jumpToRadio">
        <SvgIcon :depth="3" name="Podcast" size="20" />
        <span class="name-text text-hidden">{{ musicStore.playSong.dj?.name || "播客电台" }}</span>
      </div>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import { useMusicStore, useStatusStore, useSettingStore } from "@/stores";
import { debounce } from "lodash-es";
import { removeBrackets } from "@/utils/format";
import { openJumpArtist } from "@/utils/modal";
import { radioProgramDetail } from "@/api/radio";
const props = defineProps<{
  /** 数据居中 */
  center?: boolean;
  /** 少量数据模式 */
  light?: boolean;
}>();

const router = useRouter();
const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();

// 左侧外边距
const leftMargin = computed(() => {
  if (props.center || !props.light) return "0px";
  const offset = settingStore.lyricHorizontalOffset;
  return settingStore.useAMLyrics ? `${offset + 40}px` : `${offset + 10}px`;
});

// 跳转歌手：非网易云歌曲的歌手 ID 无效，交给通用逻辑按名称解析
const jumpArtist = (id?: number, name?: string) => {
  statusStore.showFullPlayer = false;
  openJumpArtist(musicStore.playSong.artists, id, musicStore.playSong.origin, name);
};

// 暂不支持查看主播主页
const showCreatorTip = () => window.$message.info("暂不支持查看主播主页");

// 跳转到播客电台页面
const jumpToRadio = debounce(
  async () => {
    const song = musicStore.playSong;
    let radioId = song.dj?.radioId;
    // 兼容旧数据：通过节目详情 API 获取电台 ID
    if (!radioId && song.id) {
      try {
        const res = await radioProgramDetail(song.id);
        radioId = res.program?.radio?.id;
        // 回写避免重复请求
        if (radioId && song.dj) song.dj.radioId = radioId;
      } catch (_e) {
        // ignore
      }
    }
    if (!radioId) return;
    statusStore.showFullPlayer = false;
    router.push({ name: "radio", query: { id: radioId } });
  },
  300,
  {
    leading: true,
    trailing: false,
  },
);
</script>

<style lang="scss" scoped>
.player-data {
  display: flex;
  flex-direction: column;
  width: 70%;
  max-width: 50vh;
  margin-top: 24px;
  padding: 0 2px;
  // mix-blend-mode: plus-lighter;
  .n-icon {
    color: rgb(var(--main-cover-color));
  }
  .name {
    position: relative;
    display: flex;
    align-items: center;
    margin-left: 4px;
    .name-text {
      font-size: 26px;
      font-weight: bold;
    }
    .n-icon {
      margin-left: 12px;
      transform: translateY(1px);
      cursor: pointer;
    }
  }
  .alia {
    margin: 6px 0 6px 4px;
    opacity: 0.6;
    font-size: 18px;
    line-clamp: 1;
    -webkit-line-clamp: 1;
  }
  .artists {
    display: flex;
    align-items: center;
    .n-icon {
      margin-right: 4px;
    }
    .ar-list {
      display: -webkit-box;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      word-break: break-all;
      .ar {
        font-size: 16px;
        opacity: 0.7;
        display: inline-flex;
        transition: opacity 0.3s;
        cursor: pointer;
        &::after {
          content: "/";
          margin: 0 4px;
          transition: none;
        }
        &:last-child {
          &::after {
            display: none;
          }
        }
        &:hover {
          opacity: 1;
        }
      }
    }
  }
  .dj {
    font-size: 16px;
    display: flex;
    align-items: center;
    .n-icon {
      margin-right: 4px;
    }
    .name-text {
      opacity: 0.7;
      transition: opacity 0.3s;
      line-clamp: 1;
      -webkit-line-clamp: 1;
      cursor: pointer;
      &:hover {
        opacity: 1;
      }
    }
  }
  &.record {
    width: 100%;
    padding: 0 80px 0 24px;
    .name {
      .name-text {
        font-size: 30px;
      }
      .extra-info {
        position: absolute;
        right: -34px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }
    @media (max-width: 990px) {
      padding: 0 2px;
    }
  }
  &.center {
    align-items: center;
    padding: 0 40px;
    .name {
      text-align: center;
    }
  }
  &.light {
    .name {
      .name-text {
        line-clamp: 1;
        -webkit-line-clamp: 1;
      }
      .extra-info {
        display: none;
      }
    }
    .alia {
      display: none;
    }
  }
}
.player-tip {
  max-width: 240px;
  padding: 12px 20px;
  border-radius: 12px;
  color: rgb(var(--main-cover-color));
  background-color: rgba(var(--main-cover-color), 0.18);
  backdrop-filter: blur(10px);
}
</style>
