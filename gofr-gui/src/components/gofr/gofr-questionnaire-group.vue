<template>
  <v-card
    class="mx-auto"
    max-width="700"
    outlined
    >
    <v-card-title class="primary white--text text-uppercase font-weight-bold">{{ label }}</v-card-title>
    <v-card-text v-for="(error,idx) in errors" :key="idx" class="error white--text font-weight-bold">{{error}}</v-card-text>
    <v-card-text class="my-3">
      <slot></slot>
    </v-card-text>
  </v-card>
</template>

<script>
export default {
  name: "gofr-questionnaire-group",
  props: ["label", "path", "constraints"],
  data: function() {
    return {
      isQuestionnaireGroup: true,
      errors: []
    }
  }
}
</script>
