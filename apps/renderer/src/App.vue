<template>
  <PetRoot v-if="mode === 'pet'" />
  <PanelRoot v-else />
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
import PetRoot from './pet/PetRoot.vue'
import PanelRoot from './panel/PanelRoot.vue'

defineProps<{ mode?: string }>()
</script>
