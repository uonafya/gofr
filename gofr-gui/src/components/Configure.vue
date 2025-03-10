<template>
  <v-container>
    <v-dialog
      persistent
      v-model="autoDisableSingleDatasourceDialog"
      max-width="500px"
    >
      <v-card>
        <v-toolbar
          color="error"
          dark
        >
          <v-toolbar-title>
            Disabling Single Data Source Limit
          </v-toolbar-title>
          <v-spacer></v-spacer>
          <v-btn
            icon
            dark
            @click.native="autoDisableSingleDatasource('cancel')"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>
        <v-card-text>
          Disabling limiting reconciliation to be done against one choosen data source will also disable the single data source limit, click OK to proceed
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="primary"
            @click.native="autoDisableSingleDatasource('cancel')"
          >Cancel</v-btn>
          <v-spacer></v-spacer>
          <v-btn
            color="error"
            @click.native="autoDisableSingleDatasource('ok')"
          >Ok</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      persistent
      v-model="defineSuperuserRole"
      width="620px"
    >
      <v-card>
        <v-toolbar
          color="primary"
          dark
        >
          <v-toolbar-title>
            DHIS2 superuser role that can be an administrator of GOFR
          </v-toolbar-title>
        </v-toolbar>
        <v-card-text>
          <v-select
            @change="saveConfiguration('generalConfig', 'externalAuth')"
            label="Superuser Role Name"
            item-text='displayName'
            item-value='id'
            :loading="loadingDhis2Roles"
            required
            :items="dhis2Roles"
            v-model="$store.state.config.generalConfig.externalAuth.adminRole"
          ></v-select>
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="primary"
            :disabled='!$store.state.config.generalConfig.externalAuth.adminRole || dhis2Roles.length === 0'
            @click="saveConfiguration('generalConfig', 'authDisabled')"
          >
            <v-icon left>mdi-content-save</v-icon>
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      persistent
      v-model="selectDatasourceDialog"
      width="800px"
    >
      <v-card>
        <v-toolbar
          color="primary"
          dark
        >
          <v-toolbar-title>
            Select datasource to fix source 2
          </v-toolbar-title>
          <v-spacer></v-spacer>
          <v-text-field
            v-model="searchDatasource"
            append-icon="search"
            label="Search"
            single-line
            hide-details
          ></v-text-field>
          <v-btn
            icon
            dark
            @click.native="closeDatasourceDialog"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-toolbar>
        This lists only those datasets that have been shared to all users
        <v-card-text>
          <v-data-table
            :headers="dataSourceHeaders"
            :items="sharedToAllDatasets"
            dark
            class="elevation-1"
            :search="searchDatasource"
          >
            <v-progress-linear
              slot="progress"
              color="blue"
              indeterminate
            ></v-progress-linear>
            <template
              v-slot:item="{ item }"
            >
              <tr>
                <v-radio-group
                  v-model='fixSource2To'
                  style="height: 5px"
                >
                  <td>
                    <v-radio
                      :value="item.id"
                      color="blue"
                    ></v-radio>
                  </td>
                </v-radio-group>
                <td>{{item.name}}</td>
                <td>{{item.userID.userName}}</td>
                <td>
                  {{item.createdTime}}
                </td>
              </tr>
            </template>
          </v-data-table>
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="error"
            @click="closeDatasourceDialog"
          >
            <v-icon left>mdi-cancel</v-icon>
            Cancel
          </v-btn>
          <v-spacer></v-spacer>
          <v-btn
            color="primary"
            :disabled='!fixSource2To || sharedToAllDatasets.length === 0'
            @click="savefixSource2To"
          >
            <v-icon left>mdi-content-save</v-icon>
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-card>
      <v-card-title primary-title>
        <b>System Configurations</b>
      </v-card-title>
      <v-card-text>
        <v-card>
          <v-card-title primary-title>
            User Configurations
          </v-card-title>
          <v-card-text>
            <v-layout column>
              <v-flex>
                <v-switch
                  @change="saveConfiguration('userConfig', 'useCSVHeader')"
                  color="primary"
                  label="Apply user defined headers when reconciling"
                  v-model="$store.state.config.userConfig.reconciliation.useCSVHeader"
                >
                </v-switch>
              </v-flex>
              <v-flex>
                <v-autocomplete
                  @change="saveConfiguration('userConfig', 'useCSVHeader')"
                  :items="$store.state.dataSources"
                  item-text="display"
                  item-value="name"
                  v-model="$store.state.config.userConfig.FRDatasource"
                  label="Facility Registry Datasource"
                ></v-autocomplete>
              </v-flex>
            </v-layout>
          </v-card-text>
        </v-card>
        <v-divider></v-divider>
        <v-divider></v-divider>
        <v-divider></v-divider>
        <v-card v-if="$tasksVerification.hasPermissionByName('special', 'custom', 'change-admin-config')">
          <v-card-title>
            Admin Configurations
          </v-card-title>
          <v-card-text>
            <v-layout column>
              <v-flex>
                <v-switch
                  @change="saveConfiguration('generalConfig', 'parentConstraint')"
                  color="primary"
                  label="Perform match based on parent constraint"
                  v-model="$store.state.config.generalConfig.reconciliation.parentConstraint.enabled"
                >
                </v-switch>
                <v-card
                  v-if="!$store.state.config.generalConfig.reconciliation.parentConstraint.enabled"
                  color="grey lighten-3"
                  style="margin-left:100px"
                >
                  <v-checkbox
                    @change="saveConfiguration('generalConfig', 'parConstrIdAuto')"
                    color="primary"
                    label="Automatch By ID"
                    v-model="$store.state.config.generalConfig.reconciliation.parentConstraint.idAutoMatch"
                    disabled
                  ></v-checkbox>
                  <v-checkbox
                    @change="saveConfiguration('generalConfig', 'parConstrNameAuto')"
                    color="primary"
                    label="Automatch By Name (when parents differ)"
                    v-model="$store.state.config.generalConfig.reconciliation.parentConstraint.nameAutoMatch"
                  ></v-checkbox>
                </v-card>
                <v-card>
                  <v-card-title primary-title>
                    Choose ways datasets can be added
                  </v-card-title>
                  <v-card-text>
                    <v-checkbox
                      label="CSV Upload"
                      v-model="$store.state.config.generalConfig.datasetsAdditionWays"
                      value="CSV Upload"
                      @change="checkDatasetsAdditionWays('upload')"
                    ></v-checkbox>
                    <v-checkbox
                      label="Remote Servers Sync"
                      v-model="$store.state.config.generalConfig.datasetsAdditionWays"
                      value="Remote Servers Sync"
                      @change="checkDatasetsAdditionWays('remote')"
                    ></v-checkbox>
                    <v-checkbox
                      label="Blank Datasource"
                      v-model="$store.state.config.generalConfig.datasetsAdditionWays"
                      value="Blank Datasource"
                      @change="checkDatasetsAdditionWays('blank')"
                    ></v-checkbox>
                  </v-card-text>
                </v-card>
                <v-switch
                  @change="saveConfiguration('generalConfig', 'allowShareToAllForNonAdmin')"
                  color="primary"
                  label="Allow non admin users to share datasets will all users"
                  v-model="$store.state.config.generalConfig.allowShareToAllForNonAdmin"
                >
                </v-switch>
                <v-tooltip top>
                  <template v-slot:activator="{ on }">
                    <v-switch
                      @change="displayDatasourceDialog"
                      color="primary"
                      label="Select a data source to serve as Source 2 for all reconciliation"
                      v-model="$store.state.config.generalConfig.reconciliation.fixSource2"
                      v-on="on"
                    />
                  </template>
                  <span>This will limit users to perform reconciliations against the chosen data source</span>
                </v-tooltip>
                <template v-slot:activator="{ on }">
                  <template v-if='$store.state.config.generalConfig.reconciliation.fixSource2'>
                    Source2 Limited To: <v-chip>{{fixedSource2To}}</v-chip>
                      <v-tooltip top>
                        <v-btn
                          fab
                          dark
                          color="primary"
                          small
                          @click="displayDatasourceDialog"
                          v-on="on"
                        >
                          <v-icon dark>mdi-format-list-bulleted</v-icon>
                        </v-btn>
                        <span>Change dataset</span>
                      </v-tooltip>
                  </template>
                </template>
                <v-switch
                  @change="singleDatasource"
                  color="primary"
                  label="Single data source per user"
                  v-model="$store.state.config.generalConfig.reconciliation.singleDataSource"
                >
                </v-switch>
                <v-switch
                  v-if="$store.state.dhis.user.orgId"
                  @change="saveConfiguration('generalConfig', 'singlePair')"
                  color="primary"
                  label="Single data source pair per org unit"
                  v-model="$store.state.config.generalConfig.reconciliation.singlePair"
                >
                </v-switch>
              </v-flex>
              <v-flex>
                <v-card>
                  <v-card-title primary-title>
                    GOFR Authentication
                  </v-card-title>
                  <v-card-text>
                    <v-switch
                      @change="disableGOFRAuth"
                      color="primary"
                      label="Disable Authentication"
                      v-model="$store.state.config.generalConfig.authDisabled"
                    >
                    </v-switch>
                    <v-card
                      v-if="$store.state.config.generalConfig.authDisabled"
                      color="grey lighten-3"
                      style="margin-left:100px"
                    >
                      External Authentication Method
                      <v-radio-group
                        v-model="$store.state.config.generalConfig.authMethod"
                        @change="saveConfiguration('generalConfig', 'useDhis2Auth')"
                      >
                        <v-radio
                          label="dhis2"
                          value="dhis2"
                          disabled
                        ></v-radio>
                        <v-radio
                          label="iHRIS"
                          value="iHRIS"
                          disabled
                        ></v-radio>
                      </v-radio-group>
                      <v-select
                        style="width: 350px"
                        @change="saveConfiguration('generalConfig', 'externalAuth')"
                        label="Superuser Role Name"
                        item-text='displayName'
                        item-value='id'
                        :loading="loadingDhis2Roles"
                        required
                        :items="dhis2Roles"
                        v-model="$store.state.config.generalConfig.externalAuth.adminRole"
                      ></v-select>
                      <v-checkbox
                        @change="saveConfiguration('generalConfig', 'externalAuth')"
                        v-if="$store.state.config.generalConfig.authMethod"
                        label="Pull org units"
                        v-model="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                      >
                      </v-checkbox>
                      <v-checkbox
                        @change="saveConfiguration('generalConfig', 'externalAuth')"
                        v-if="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                        label="Share orgs with other users"
                        v-model="$store.state.config.generalConfig.externalAuth.shareOrgUnits"
                      >
                      </v-checkbox>
                      <v-checkbox
                        @change="saveConfiguration('generalConfig', 'externalAuth')"
                        v-if="
                      $store.state.config.generalConfig.externalAuth.shareOrgUnits &&
                      $store.state.config.generalConfig.externalAuth.pullOrgUnits
                    "
                        label="Limit orgs sharing by user orgid"
                        v-model="$store.state.config.generalConfig.externalAuth.shareByOrgId"
                      >
                      </v-checkbox>
                      <v-text-field
                        style="width: 350px"
                        outline
                        v-if="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                        label="Dataset Name"
                        v-model="$store.state.config.generalConfig.externalAuth.datasetName"
                        @blur="ensureNameUnique"
                        @input="ensureNameUnique"
                        :error-messages="datasetNameErrors"
                        required
                      ></v-text-field>
                      <v-text-field
                        style="width: 350px"
                        outline
                        v-if="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                        label="Username"
                        v-model="$store.state.config.generalConfig.externalAuth.userName"
                        required
                      ></v-text-field>
                      <v-text-field
                        style="width: 350px"
                        outline
                        v-if="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                        label="Password"
                        v-model="$store.state.config.generalConfig.externalAuth.password"
                        type="password"
                        required
                      ></v-text-field>
                      <v-flex xs3>
                        <v-btn
                          color="primary"
                          :disabled='datasetNameErrors.length > 0 || !$store.state.config.generalConfig.externalAuth.datasetName'
                          small
                          round
                          v-if="$store.state.config.generalConfig.externalAuth.pullOrgUnits"
                          @click="pullOrgUnits"
                        >start pulling</v-btn>
                      </v-flex>
                    </v-card>
                  </v-card-text>
                </v-card>
              </v-flex>
              <v-divider></v-divider>
              <v-flex>
                <v-card>
                  <v-card-title primary-title>
                    Self Registration
                  </v-card-title>
                  <v-card-text>
                    <v-switch
                      @change="saveConfiguration('generalConfig', 'selfRegistration')"
                      color="primary"
                      label="Enable self registration"
                      v-model="$store.state.config.generalConfig.selfRegistration.enabled"
                    >
                    </v-switch>
                    <v-switch
                      @change="saveConfiguration('generalConfig', 'selfRegistration')"
                      color="primary"
                      label="Requires Admin Approval Of Self Registration"
                      v-model="$store.state.config.generalConfig.selfRegistration.requiresApproval"
                    >
                    </v-switch>
                  </v-card-text>
                </v-card>
              </v-flex>
              <v-divider></v-divider>
              <v-flex xs1>
                <v-card>
                  <v-card-title primary-title>
                    Cron Jobs
                  </v-card-title>
                  <v-card-text>
                    Autosync Below Remote Datasets
                    <v-text-field
                      style="width: 350px"
                      outline
                      @blur="saveConfiguration('generalConfig', 'datasetsAutosyncTime')"
                      name="cron_time"
                      label="Cron Time"
                      v-model="$store.state.config.generalConfig.datasetsAutosyncTime"
                    ></v-text-field>
                    <v-data-table
                      :headers="cronDataSourceHeaders"
                      :items="remoteDatasets"
                      hide-default-footer
                      class="elevation-1"
                      pagination.sync="pagination"
                    >
                      <template
                        v-slot:item="{ item }"
                      >
                        <tr>
                          <td>{{item.display}}</td>
                          <td>{{item.owner}}</td>
                          <td>
                            {{item.createdTime}}
                          </td>
                          <td>
                            {{item.lastUpdate}}
                          </td>
                          <td>
                            <v-switch
                              @change="controlDatasetsCronjobs(item)"
                              color="primary"
                              v-model="datasetsAutosyncState[item.id]"
                            >
                            </v-switch>
                          </td>
                        </tr>
                      </template>
                    </v-data-table>
                  </v-card-text>
                </v-card>
              </v-flex>
              <v-flex xs1>
                <v-card color="grey lighten-3">
                  <v-card-text>
                    SMTP Configuration For Email Notifications
                  </v-card-text>
                  <v-card-actions>
                    <v-layout column>
                      <v-flex>
                        <v-text-field
                          label="SMTP Host"
                          v-model="smtp.host"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-text-field
                          label="SMTP Port"
                          v-model="smtp.port"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-text-field
                          label="SMTP Username"
                          v-model="smtp.username"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-text-field
                          type="password"
                          label="SMTP Password"
                          v-model="smtp.password"
                          autocomplete='new-password'
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-switch
                          color="primary"
                          label="SMTP Secured"
                          v-model="smtp.secured"
                        >
                        </v-switch>
                      </v-flex>
                      <v-flex>
                        <v-layout
                          row
                          wrap
                        >
                          <v-spacer></v-spacer>
                          <v-flex xs1>
                            <v-btn
                              color="primary"
                              @click="saveSMTP"
                            >
                              <v-icon>mdi-content-save</v-icon>Save
                            </v-btn>
                          </v-flex>
                        </v-layout>
                      </v-flex>
                    </v-layout>
                  </v-card-actions>
                </v-card>
              </v-flex>
              <v-flex xs1>
                <v-switch
                  @change="saveConfiguration('generalConfig', 'recoProgressNotification')"
                  color="primary"
                  label="Enable Endpoint Notification when reconciliation is done"
                  v-model="$store.state.config.generalConfig.recoProgressNotification.enabled"
                >
                </v-switch>
                <v-card
                  color="grey lighten-3"
                  v-if='$store.state.config.generalConfig.recoProgressNotification.enabled'
                  style="margin-left:100px"
                >
                  <v-card-text>
                    End point to send notification when reconciliation is done
                  </v-card-text>
                  <v-card-actions>
                    <v-layout column>
                      <v-flex>
                        <v-text-field
                          label="End point URL"
                          v-model="notification_endpoint"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-text-field
                          label="End point Username"
                          v-model="notification_username"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-text-field
                          label="End point Password"
                          v-model="notification_password"
                          filled
                        ></v-text-field>
                      </v-flex>
                      <v-flex>
                        <v-layout
                          row
                          wrap
                        >
                          <v-spacer></v-spacer>
                          <v-flex xs1>
                            <v-btn
                              color="primary"
                              @click="recoProgressNotificationChanged"
                            >
                              <v-icon>mdi-content-save</v-icon>Save
                            </v-btn>
                          </v-flex>
                        </v-layout>
                      </v-flex>
                    </v-layout>
                  </v-card-actions>
                </v-card>
              </v-flex>
            </v-layout>
          </v-card-text>
        </v-card>
      </v-card-text>
    </v-card>
    <appRemoteSync
      syncType="dhisSync"
      :serverName="$store.state.config.generalConfig.externalAuth.datasetName"
      :userID="$store.state.auth.userID"
      :sourceOwner="$store.state.auth.userID"
      mode="full"
    >
    </appRemoteSync>
  </v-container>
</template>
<script>
import axios from 'axios'
import RemoteSync from './DataSources/RemoteSync'
import { eventBus } from '@/main'
import { required } from 'vuelidate/lib/validators'
import { generalMixin } from '@/mixins/generalMixin'
export default {
  mixins: [generalMixin],
  validations: {
    facility: {
      required: required
    },
    code: {
      required: required
    },
    uploadName: {
      required: required
    }
  },
  data () {
    return {
      smtp: {
        host: '',
        port: '',
        username: '',
        password: '',
        secured: true
      },
      autoDisableSingleDatasourceDialog: false,
      selectDatasourceDialog: false,
      fixSource2To: '',
      searchDatasource: '',
      dataSourceHeaders: [
        { sortable: false },
        { text: 'Source Name', align: 'left', value: 'name' },
        { text: 'Owner', value: 'owner', sortable: false },
        { text: 'Created Time', value: 'createdTime' }
      ],
      cronDataSourceHeaders: [
        { text: 'Source Name', align: 'left', value: 'name' },
        { text: 'Owner', value: 'owner', sortable: false },
        { text: 'Created Time', value: 'createdTime' },
        { text: 'Last Updated Time', value: 'createdTime' },
        { text: 'Enabled', value: 'enabled' }
      ],
      datasetsAutosyncState: {},
      useCSVHeader: false,
      moreFields: false,
      fieldLabel: '',
      fieldName: '',
      required: 'No',
      requiredText: ['Yes', 'No'],
      notification_endpoint: '',
      notification_username: '',
      notification_password: '',
      dhis2Roles: [],
      loadingDhis2Roles: false,
      datasetNameErrors: [],
      defineSuperuserRole: false
    }
  },
  methods: {
    controlDatasetsCronjobs (dataset) {
      let formData = new FormData()
      formData.append('id', dataset.id)
      formData.append('enabled', this.datasetsAutosyncState[dataset.id])
      axios.post('/datasource/updateDatasetAutosync', formData)
    },
    checkDatasetsAdditionWays (way) {
      if (this.$store.state.config.generalConfig.datasetsAdditionWays.length === 0) {
        this.$store.state.errorTitle = 'Cant disable both ways'
        this.$store.state.errorDescription = 'There must be atleast one way of adding a dataset'
        this.$store.state.dialogError = true
        let additionWay
        if (way === 'remote') {
          additionWay = 'Remote Servers Sync'
        } else if (way === 'upload') {
          additionWay = 'CSV Upload'
        } else if (way === 'blank') {
          additionWay = 'Blank Datasource'
        }
        this.$store.state.config.generalConfig.datasetsAdditionWays.push(additionWay)
      } else {
        this.saveConfiguration('generalConfig', 'datasetsAdditionWays')
      }
    },
    autoDisableSingleDatasource (confirmation) {
      if (confirmation === 'ok') {
        this.$store.state.config.generalConfig.reconciliation.singleDataSource = false
        this.saveConfiguration('generalConfig', 'fixSource2')
        this.saveConfiguration('generalConfig', 'singleDataSource')
      } else if (confirmation === 'cancel') {
        this.$store.state.config.generalConfig.reconciliation.fixSource2 = true
      }
      this.autoDisableSingleDatasourceDialog = false
    },
    singleDatasource () {
      if (
        this.$store.state.config.generalConfig.reconciliation.singleDataSource
      ) {
        if (
          !this.$store.state.config.generalConfig.reconciliation.fixSource2To ||
          !this.$store.state.config.generalConfig.reconciliation.fixSource2
        ) {
          this.$store.state.dialogError = true
          this.$store.state.errorTitle = 'Error'
          this.$store.state.errorColor = 'error'
          this.$store.state.errorDescription = 'This feature can only be enabled if there is a defined datasource to serve as Source 2 for all reconciliation'
          setTimeout(() => {
            this.$store.state.config.generalConfig.reconciliation.singleDataSource = false
          })
        } else {
          this.saveConfiguration('generalConfig', 'singleDataSource')
        }
      } else {
        this.saveConfiguration('generalConfig', 'singleDataSource')
      }
    },
    displayDatasourceDialog () {
      if (
        this.$store.state.config.generalConfig.reconciliation.fixSource2 ===
        true
      ) {
        this.fixSource2To = this.$store.state.config.generalConfig.reconciliation.fixSource2To
        this.selectDatasourceDialog = true
        this.saveConfiguration('generalConfig', 'fixSource2')
      } else {
        if (this.$store.state.config.generalConfig.reconciliation.singleDataSource) {
          this.autoDisableSingleDatasourceDialog = true
        } else {
          this.saveConfiguration('generalConfig', 'fixSource2')
        }
      }
    },
    closeDatasourceDialog () {
      this.selectDatasourceDialog = false
      if (!this.$store.state.config.generalConfig.reconciliation.fixSource2To) {
        this.$store.state.config.generalConfig.reconciliation.fixSource2 = false
        this.saveConfiguration('generalConfig', 'fixSource2')
      }
    },
    savefixSource2To () {
      this.$store.state.config.generalConfig.reconciliation.fixSource2To = this.fixSource2To
      this.saveConfiguration('generalConfig', 'fixSource2To')
      this.selectDatasourceDialog = false
    },
    disableGOFRAuth () {
      if (!this.$store.state.config.generalConfig.authDisabled) {
        this.saveConfiguration('generalConfig', 'authDisabled')
      } else if (this.$store.state.config.generalConfig.authDisabled) {
        let isSet = this.setDHIS2Credentials()
        if (!isSet) {
          this.$store.state.dialogError = true
          this.$store.state.errorTitle = 'Error'
          this.$store.state.errorColor = 'error'
          this.$store.state.errorDescription = 'App doesnt appear to be running inside DHIS2, cant disable authentication'
          setTimeout(() => {
            this.$store.state.config.generalConfig.authDisabled = false
          })
          return
        }
        this.loadingDhis2Roles = true
        this.getDHIS2Roles(roles => {
          this.loadingDhis2Roles = false
          this.dhis2Roles = [...roles.data.userRoles]
        })
        this.defineSuperuserRole = true
      }
    },
    recoProgressNotificationChanged () {
      if (!this.$store.state.config.generalConfig.hasOwnProperty('recoProgressNotification')) {
        this.$store.state.config.generalConfig.recoProgressNotification = {}
      }
      this.$store.state.config.generalConfig.recoProgressNotification.url = this.notification_endpoint
      this.$store.state.config.generalConfig.recoProgressNotification.username = this.notification_username
      this.$store.state.config.generalConfig.recoProgressNotification.password = this.notification_password
      this.saveConfiguration('generalConfig')
    },
    saveSMTP () {
      this.$store.state.config.generalConfig.smtp.host = this.smtp.host
      this.$store.state.config.generalConfig.smtp.port = this.smtp.port
      this.$store.state.config.generalConfig.smtp.username = this.smtp.username
      this.$store.state.config.generalConfig.smtp.password = this.smtp.password
      this.$store.state.config.generalConfig.smtp.secured = this.smtp.secured
      this.saveConfiguration('generalConfig', 'smtp')
      this.$store.state.dialogError = true
      this.$store.state.errorColor = 'primary'
      this.$store.state.errorTitle = 'Info'
      this.$store.state.errorDescription = 'SMTP saved'
    },
    pullOrgUnits () {
      this.saveConfiguration('generalConfig', 'externalAuth')
      let formData = new FormData()
      formData.append('host', this.$store.state.dhis.host)
      formData.append('sourceType', 'DHIS2')
      formData.append('source', 'syncServer')
      formData.append(
        'shareToAll',
        this.$store.state.config.generalConfig.externalAuth.shareOrgUnits
      )
      formData.append(
        'limitByUserLocation',
        this.$store.state.config.generalConfig.externalAuth.shareByOrgId
      )
      formData.append(
        'username',
        this.$store.state.config.generalConfig.externalAuth.userName
      )
      formData.append(
        'password',
        this.$store.state.config.generalConfig.externalAuth.password
      )
      formData.append(
        'name',
        this.$store.state.config.generalConfig.externalAuth.datasetName
      )
      formData.append('userID', this.$store.state.auth.userID)

      axios
        .post('/addDataSource', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        .then(() => {
          eventBus.$emit('runRemoteSync')
        })
    },
    getDHIS2Roles (callback) {
      let auth = this.$store.state.dhis.dev.auth
      if (auth.username === '') {
        auth = ''
      }
      axios
        .get(this.$store.state.dhis.host + 'api/userRoles', { auth })
        .then(roles => {
          callback(roles)
        })
    },
    ensureNameUnique () {
      this.datasetNameErrors = []
      if (
        this.$store.state.config.generalConfig.externalAuth.datasetName === ''
      ) {
        return this.datasetNameErrors.push('Dataset name is required')
      }
      for (let dtSrc of this.$store.state.dataSources) {
        if (dtSrc.name === this.uploadName) {
          this.datasetNameErrors.push('This Name Exists')
          return false
        }
      }
    }
  },
  created () {
    this.smtp.host = this.$store.state.config.generalConfig.smtp.host
    this.smtp.port = this.$store.state.config.generalConfig.smtp.port
    this.smtp.username = this.$store.state.config.generalConfig.smtp.username
    this.smtp.password = this.$store.state.config.generalConfig.smtp.password
    this.smtp.secured = this.$store.state.config.generalConfig.smtp.secured
    if (
      this.$store.state.config.generalConfig.authDisabled &&
      this.$store.state.config.generalConfig.authMethod === 'dhis2'
    ) {
      this.loadingDhis2Roles = true
      this.getDHIS2Roles(roles => {
        this.loadingDhis2Roles = false
        this.dhis2Roles = [...roles.data.userRoles]
      })
    }
    if (
      this.$store.state.config.generalConfig.hasOwnProperty(
        'recoProgressNotification'
      )
    ) {
      this.notification_endpoint = this.$store.state.config.generalConfig.recoProgressNotification.url
      this.notification_username = this.$store.state.config.generalConfig.recoProgressNotification.username
      this.notification_password = this.$store.state.config.generalConfig.recoProgressNotification.password
    }

    for (let sources of this.$store.state.dataSources) {
      if (sources.source === 'syncServer') {
        if (sources.autoSync) {
          this.datasetsAutosyncState[sources.id] = true
        } else {
          this.datasetsAutosyncState[sources.id] = false
        }
      }
    }
  },
  computed: {
    fixedSource2To () {
      let dtSrc = ''
      for (let source of this.$store.state.dataSources) {
        if (
          source.id ===
          this.$store.state.config.generalConfig.reconciliation.fixSource2To
        ) {
          dtSrc = source
        }
      }
      return dtSrc.name
    },
    sharedToAllDatasets () {
      let servers = []
      for (let sources of this.$store.state.dataSources) {
        if (sources.shareToAll && sources.shareToAll.activated) {
          servers.push(sources)
        } else {
          servers.push(sources)
        }
      }
      return servers
    },
    remoteDatasets () {
      let servers = []
      for (let sources of this.$store.state.dataSources) {
        if (sources.source === 'syncServer') {
          servers.push(sources)
        }
      }
      return servers
    }
  },
  beforeCreate () {
    if (!this.$store.state.config.generalConfig.hasOwnProperty('authMethod')) {
      this.$set(this.$store.state.config.generalConfig, 'authMethod', 'dhis2')
    }
    if (
      !this.$store.state.config.generalConfig.hasOwnProperty('externalAuth')
    ) {
      let externalAuth = {
        pullOrgUnits: true,
        shareOrgUnits: false,
        shareByOrgId: false,
        datasetName: '',
        adminRole: ''
      }
      this.$set(
        this.$store.state.config.generalConfig,
        'externalAuth',
        externalAuth
      )
    }
  },
  components: {
    appRemoteSync: RemoteSync
  }
}
</script>
