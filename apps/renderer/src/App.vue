<template>
  <PetRoot v-if="mode === 'pet'" />
  <IndexBar v-else-if="mode === 'index'" />
  <PanelRoot v-else />
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
import PetRoot from './pet/PetRoot.vue'
import PanelRoot from './panel/PanelRoot.vue'
import IndexBar from './index/IndexBar.vue'

defineProps<{ mode?: string }>()
</script>
