<template>
  <img
    :src="lyraLogo"
    :width="size"
    :height="size"
    :style="{ borderRadius: `${Math.round(size * 0.225)}px` }"
    class="lyra-logo"
    alt="Lyra"
    draggable="false"
  />
</template>

<script setup lang="ts">
import lyraLogo from "@/assets/lyra-logo.png";

defineProps({
  size: {
    type: Number,
    default: 36,
  },
});
</script>

<style lang="scss" scoped>
.lyra-logo {
  display: block;
  object-fit: cover;
  user-select: none;
}
</style>
