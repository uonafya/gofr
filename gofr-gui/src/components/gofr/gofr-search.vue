<template>
  <v-container class="py-5">
    <v-card>
      <v-card-title>
        Search {{ label }}
        <v-spacer></v-spacer>
        <!-- <v-btn :class="addLink ? addLink.class || 'primary' : 'primary'" :to="addLink ? addLink.url : '/resource/add/'+page">
          <v-icon v-if="addLink && addLink.icon">{{ addLink.icon }}</v-icon>
          <v-icon v-else>mdi-database-plus</v-icon>
          Add {{label}}
        </v-btn> -->
      </v-card-title>
      <v-card-title>
        <slot></slot>
      </v-card-title>
      <v-card-subtitle
        v-if="error_message"
        class="white--text error"
      >{{ error_message }}</v-card-subtitle>
      <v-card-text>
        <v-container>
        </v-container>
        <v-data-table
          style="cursor: pointer"
          :headers="headers"
          :items="results"
          item-key="id"
          :options.sync="options"
          :server-items-length="total"
          :footer-props="{ 'items-per-page-options': [5,10,20,50] }"
          :loading="loading"
          class="elevation-1"
          @click:row="clickIt"
        ></v-data-table>
      </v-card-text>
    </v-card>

  </v-container>
</template>

<script>
import axios from 'axios';
export default {
  name: "gofr-search",
  props: ["profile", "request-updating-resource", "request-action", "search-action", "fields", "label", "terms", "page", "resource", "add-link"],
  data: function() {
    return {
      debug: "",
      headers: [],
      results: [],
      options: { itemsPerPage: 10 },
      loading: false,
      total: 0,
      prevPage: -1,
      link: [],
      error_message: null,
      update_again: { rerun: false, restart: false }
    };
  },
  watch: {
    terms: {
      handler() {
        this.getData(true);
      },
      deep: true
    },
    options: {
      handler() {
        this.getData();
      },
      deep: true
    }
  },
  created: function() {
    for (let field of this.fields) {
      this.headers.push({ text: field[0], value: field[1] });
    }
  },
  mounted: function() {
    this.getData(true);
  },
  methods: {
    clickIt: function(record) {
      this.$store.state.searchAction = this.searchAction
      this.$store.state.requestResourceUpdateData.requestAction = this.requestAction
      this.$store.state.requestResourceUpdateData.requestUpdatingResource = this.requestUpdatingResource
      this.$router.push({
        path: `/Resource/View/${this.page}/${record.id}`
      });
    },
    checkRerun() {
      if ( !this.loading && this.update_again.rerun ) {
        this.getData( this.update_again.restart )
        this.update_again = { rerun: false, restart: false }
      }
    },
    getData(restart) {
      if ( this.loading ) {
        this.update_again.rerun = true
        this.update_again.restart = this.update_again.restart || restart
        return
      }
      this.loading = true;
      this.error_message = null;
      let url = "";
      if (restart) this.options.page = 1;
      if (this.options.page > 1) {
        if (this.options.page === this.prevPage - 1) {
          url = this.link.find(link => link.relation === "previous").url;
        } else if (this.options.page === this.prevPage + 1) {
          url = this.link.find(link => link.relation === "next").url;
        }
        // Should make this smarter to keep the _getpages parameter,
        // but the issue is with tracking permissions on the resource
        url = url.replace(/_getpages=[^&]*&*/, "").replace("/fhir/"+this.$store.state.config.userConfig.FRDatasource+"?","/fhir/"+this.$store.state.config.userConfig.FRDatasource+"/"+this.resource+"?")
        url = url.substring(url.indexOf("/fhir/"));

        //some of the hapi instances requires _total=accurate to always be available for them to return total resources
        if(url.indexOf('_total=accurate') === -1) {
          url = url + '&_total=accurate'
        }
      }
      if (url === "") {
        let count = this.options.itemsPerPage || 10;
        let sort = "";
        for (let idx in this.options.sortBy) {
          if (sort) {
            sort += ",";
          }
          if (this.options.sortDesc[idx]) {
            sort += "-";
          }
          sort += this.options.sortBy[idx];
        }
        url =
          "/fhir/" +
          this.$store.state.config.userConfig.FRDatasource + "/" +
          this.resource +
          "?_count=" +
          count +
          "&_total=accurate&_profile=" +
          this.profile;
        let sTerms = Object.keys(this.terms);
        for (let term of sTerms) {
          if ( Array.isArray( this.terms[term] ) ) {
            if ( this.terms[term].length > 0 ) {
              url += "&" + term + "=" + this.terms[term].join(',')
            }
          } else if ( this.terms[term] ) {
            url += "&" + term + "=" + this.terms[term];
          }
        }
        this.debug = url;
      }
      this.prevPage = this.options.page;
      axios.get(url).then(async (response) => {
        let data = response.data
        this.results = [];
        if (data.total > 0) {
          this.link = data.link;
          for (let entry of data.entry) {
            let result = { id: entry.resource.id };
            for (let field of this.fields) {
              let fieldDisplay = this.$fhirpath.evaluate( entry.resource, field[1] );
              result[field[1]] = await this.$fhirutils.lookup( fieldDisplay[0], field[2] )
            }
            this.results.push(result);
          }
        }
        this.total = data.total;
        this.loading = false;
        this.checkRerun()
      }).catch(err => {
        this.loading = false;
        this.error_message = "Unable to load results.";
        this.checkRerun()
        console.log(err);
      });
    }
  }
};
</script>
