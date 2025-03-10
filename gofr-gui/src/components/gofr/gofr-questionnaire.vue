<template>
  <v-container class="my-3">

    <v-form
      ref="form"
      v-model="valid"
    >

      <slot></slot>
      <v-overlay :value="overlay">
        <v-progress-circular
          size="50"
          color="primary"
          indeterminate
          ></v-progress-circular>
        <v-btn icon @click="overlay = false"><v-icon>mdi-close</v-icon></v-btn>
      </v-overlay>

      <v-navigation-drawer
        app
        left
        permanent
        clipped
        class="primary darken-1 white--text"
        style="z-index: 3;"
        >
        <v-list class="white--text">
          <v-list-item>
            <v-btn small dark class="secondary" @click="$router.go(-1)">
              <v-icon light>mdi-pencil-off</v-icon>
              <span>Cancel</span>
            </v-btn>
            <v-spacer></v-spacer>
            <v-btn small v-if="valid" dark class="success darken-1" @click="processFHIR()" :disabled="!valid">
              <v-icon light>mdi-content-save</v-icon>
              <span>Save</span>
            </v-btn>
            <v-btn v-else dark small class="warning" @click="$refs.form.validate()">
              <v-icon light>mdi-content-save</v-icon>
              <span>Save</span>
            </v-btn>
          </v-list-item>
          <v-divider color="white"></v-divider>
          <v-subheader class="white--text" v-if="sectionMenu"><h2>Sections</h2></v-subheader>
          <v-list-item v-for="section in sectionMenu" :href="'#section-'+section.id" :key="section.id">
            <v-list-item-content class="white--text">
              <v-list-item-title class="text-uppercase"><h4>{{ section.title }}</h4></v-list-item-title>
              <v-list-item-subtitle class="white--text">{{ section.desc }}</v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </v-list>

      </v-navigation-drawer>
    </v-form>
  </v-container>

</template>

<script>
import axios from 'axios'
const querystring = require('querystring')
export default {
  name: "gofr-questionnaire",
  props: ["id", "url", "title", "description", "purpose", "section-menu", "view-page", "edit", "constraints"],
  data: function() {
    return {
      fhir: {},
      loading: false,
      overlay: false,
      isEdit: false,
      valid: true,
      advancedValid: true
    }
  },
  methods: {
    processFHIR: async function() {
      this.$refs.form.validate()
      if ( !this.valid ) return
      this.advancedValid = true
      this.overlay = true
      this.loading = true

      const processChildren = async ( obj, children, itemMap ) => {
        //console.log("called on "+parent)
        if ( !itemMap ) itemMap = {}

        for ( let child of children ) {

          let next = obj
          let myItemMap = {}

          if ( child.isArray ) {
            //console.log("ARRAY", child.path)
          } else if ( child.isQuestionnaireGroup ) {
            //console.log("GROUP", child.path)
            let section = { linkId: child.path, text: child.label, item: [] }
            next.push( section )
            next = section.item
          } else if ( child.qField ) {
            //console.log("PROCESS",path,child.qField,child.value)
            let item
            if ( itemMap.hasOwnProperty( child.path ) ) {
              item = itemMap[ child.path ]
            } else {
              item = { linkId: child.path, answer: [] }
              itemMap[child.path] = item
              next.push( item )
            }
            let answer = {}
            answer[child.qField] = child.value
            item.answer.push( answer )
            if ( child.constraints ) {
              child.errors = []
              try {
                this.advancedValid = this.advancedValid && await this.$fhirutils.checkConstraints( child.constraints,
                  this.constraints, child.value, child.errors )
              } catch( err ) {
                this.advancedValid = false
                child.errors.push("An unknown error occurred.")
                console.log(err)
              }
            }
          }

          if ( child.$children ) {
            //console.log("PROCESSING CHILDREN OF",child.path)
            try {
              await processChildren( next, child.$children, myItemMap )
            } catch( err ) {
              this.advancedValid = false
              console.log(err)
            }

          }
          if ( child.isQuestionnaireGroup && child.constraints ) {
            child.errors = []
            try {
              this.advancedValid = this.advancedValid && await this.$fhirutils.checkConstraints( child.constraints,
                this.constraints, next, child.errors )
            } catch( err ) {
              this.advancedValid = false
              child.errors.push("An unknown error occurred.")
              console.log(err)
            }
          }


        }

      }


      //console.log(this.field)
      this.fhir = {
        resourceType: "QuestionnaireResponse",
        questionnaire: this.url,
        status: "completed",
        item: []
      }
      //console.log(this)
      try {
        await processChildren( this.fhir.item, this.$children )
      } catch( err ) {
        this.advancedValid = false
        console.log(err)
      }
      if ( !this.advancedValid ) {
        this.overlay = false
        this.loading = false
        this.$store.commit('setMessage', { type: 'error', text: 'There were errors on the form.' })
        return
      }
      console.log("SAVE",this.fhir)
      console.error(JSON.stringify(this.fhir,0,2));
      axios({
        url: "/fhir/" + this.$store.state.config.userConfig.FRDatasource + "/QuestionnaireResponse?"+querystring.stringify(this.$route.query),
        method: "POST",
        data: this.fhir
      } ).then((response) => {
        this.overlay = false
        this.loading = false
        this.$store.state.alert.show = true
        this.$store.state.alert.width = '600px'
        this.$store.state.alert.msg = 'Saved successfully!'
        this.$store.state.alert.type = 'success'
        this.$router.push({ name:"ResourceView", params: {page: this.viewPage, id: response.data.subject.reference.split('/')[1] } })
      } ).catch(err => {
        this.overlay = false
        this.loading = false
        console.log(err)
        this.$store.state.alert.show = true
        this.$store.state.alert.width = '600px'
        this.$store.state.alert.msg = 'Failed to save!'
        this.$store.state.alert.type = 'error'
      } )
    }
  }
}


</script>
