<template>
  <div>
    <slot :source="source"></slot>
  </div>
</template>

<script>
export default {
  name: "fhir-codeable-concept",
  props: ["field", "slotProps","sliceName","min","max","base-min","base-max","label","path","binding","edit","constraints"],
  data: function() {
    return {
      source: { path: "", data: {}, binding: this.binding },
      errors: []
    }
  },
  created: function() {
    this.setupData()
  },
  watch: {
    slotProps: {
      handler() {
        //console.log("WATCH CODEABLECONCEPT",this.path,this.slotProps)
        this.setupData()
      },
      deep: true
    }
  },
  methods: {
    setupData: function() {
      //console.log("CC",this.field,this.path,this.source,this.slotProps)
      if ( this.slotProps && this.slotProps.source ) {
        this.source = { path: this.slotProps.source.path+"."+this.field, data: {},
          binding: this.binding }
        //console.log("CC binding",this.binding)
        if ( this.slotProps.source.fromArray ) {
          this.source.data = this.slotProps.source.data
        } else {
          let expression = this.$fhirutils.pathFieldExpression( this.field )
          this.source.data = this.$fhirpath.evaluate( this.slotProps.source.data, expression )
        }
        //console.log("CC2",this.field,this.source)
      }
    }
  },
  computed: {
    display: function() {
      if ( this.slotProps && this.slotProps.input ) return this.slotProps.input.label
      else return this.label
    }
  }
}
</script>
