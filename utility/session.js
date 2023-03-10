const psapi = require('../psapi')
const io = require('./io')
const Enum = require('../enum')
const { base64ToBase64Url } = require('./general')
const html_manip = require('./html_manip')
const layer_util = require('./layer')
const ui = require('./ui')
const selection = require('../selection')
const GenerationSettings = require('./generation_settings')
const SessionState = {
    Active: 'active',
    Inactive: 'inactive',
}
const GarbageCollectionState = {
    Accept: 'accept', // accept all generated images
    Discard: 'discard', //discard all generated images
    DiscardSelected: 'discard_selected',
    AcceptSelected: 'accept_selected', //accept_selected only chosen images
}

class GenerationSession {
    static #instance = null;

    static instance() {
        if (!GenerationSession.#instance) {
            GenerationSession.#isInternalConstructing = true;
            GenerationSession.#instance = new GenerationSession();
            GenerationSession.#isInternalConstructing = false;
        }
        return GenerationSession.#instance;
    }
    static #isInternalConstructing = false;

    constructor() {
        if (!GenerationSession.#isInternalConstructing) {
            throw new TypeError("PrivateConstructor is not constructable");
        }
        //this should be unique session id and it also should act as the total number of sessions been created in the project
        this.id = 0
        this.state = SessionState['Inactive']
        this.mode = 'txt2img'
        this.selectionInfo = null
        this.isFirstGeneration = true // only before the first generation is requested should this be true
        this.outputGroup
        this.prevOutputGroup
        this.isLoadingActive = false
        this.base64OutputImages = {} //image_id/path => base64_image
        this.base64initImages = {} //init_image_path => base64
        this.base64maskImage = []
        this.activeBase64InitImage
        this.activeBase64MaskImage
        this.image_paths_to_layers = {}
        this.progress_layer
        this.last_settings //the last settings been used for generation
        this.controlNetImage = [] // base64 images (one for each control net)
        this.controlNetMask = [] // base64 images (one for each control net)
        this.request_status = Enum.RequestStateEnum['Finished'] //finish or ideal state
        this.is_control_net = false
        this.control_net_selection_info
    }
    isActive() {
        return this.state === SessionState['Active']
    }
    isInactive() {
        return this.state === SessionState['Inactive']
    }
    activate() {
        this.state = SessionState['Active']
    }
    deactivate() {
        this.state = SessionState['Inactive']
    }
    name() {
        return `session - ${this.id}`
    }
    async startSession() {
        this.id += 1 //increment the session id for each session we start
        this.activate()
        this.isFirstGeneration = true // only before the first generation is requested should this be true

        console.log('current session id: ', this.id)
        try {
            const session_name = this.name()
            const activeLayers = await app.activeDocument.activeLayers
            await psapi.unselectActiveLayersExe() // unselect all layer so the create group is place at the top of the document
            this.prevOutputGroup = this.outputGroup
            const outputGroup = await psapi.createEmptyGroup(session_name)
            this.outputGroup = outputGroup
            await psapi.selectLayersExe(activeLayers)
        } catch (e) {
            console.warn(e)
        }
    }

    async endSession(garbage_collection_state) {
        try {
            if (!this.isActive()) {
                //return if the session is not active
                return null
            }
            this.state = SessionState['Inactive'] // end the session by deactivate it

            this.deactivate()

            if (garbage_collection_state === GarbageCollectionState['Accept']) {
                await acceptAll()
            } else if (
                garbage_collection_state === GarbageCollectionState['Discard']
            ) {
                //this should be discardAll()

                await discardAll()
            } else if (
                garbage_collection_state ===
                GarbageCollectionState['DiscardSelected']
            ) {
                //this should be discardAllExcept(selectedLayers)
                await discardSelected() //this will discard what is not been highlighted
            } else if (
                garbage_collection_state ===
                GarbageCollectionState['AcceptSelected']
            ) {
                //this should be discardAllExcept(selectedLayers)
                await discard() //this will discard what is not been highlighted
            }

            this.isFirstGeneration = true // only before the first generation is requested should this be true
            // const is_visible = await this.outputGroup.visible
            g_viewer_manager.last_selected_viewer_obj = null // TODO: move this in viewerManager endSession()
            g_viewer_manager.onSessionEnd()
            await layer_util.collapseFolderExe([this.outputGroup], false) // close the folder group
            // this.outputGroup.visible = is_visible

            if (
                this.mode === Enum.generationMode['Inpaint'] &&
                GenerationSettings.sd_mode === Enum.generationMode['Inpaint']
            ) {
                //create "Mask -- Paint White to Mask -- temporary" layer if current session was inpiant and the selected session is inpaint
                // the current inpaint session ended on inpaint
                g_b_mask_layer_exist = false
                await layer_util.deleteLayers([g_inpaint_mask_layer])
                await createTempInpaintMaskLayer()
            }
        } catch (e) {
            console.warn(e)
        }
    }
    async closePreviousOutputGroup() {
        try {
            //close the previous output folder

            if (this.prevOutputGroup) {
                // const is_visible = await this.prevOutputGroup.visible
                await layer_util.collapseFolderExe(
                    [this.prevOutputGroup],
                    false
                ) // close the folder group
                // and reselect the current output folder for clarity
                await psapi.selectLayersExe([this.outputGroup])
                // this.prevOutputGroup.visible = is_visible
            }
        } catch (e) {
            console.warn(e)
        }
    }
    isSameMode(selected_mode) {
        if (this.mode === selected_mode) {
            return true
        }
        return false
    }
    async moveToTopOfOutputGroup(layer) {
        const output_group_id = await this.outputGroup.id
        let group_index = await psapi.getLayerIndex(output_group_id)
        const indexOffset = 1 //1 for background, 0 if no background exist
        await executeAsModal(async () => {
            await psapi.selectLayersExe([layer]) //the move command is selection selection sensitive
            await psapi.moveToGroupCommand(group_index - indexOffset, layer.id)
        })
    }

    async deleteProgressLayer() {
        try {
            await layer_util.deleteLayers([this.progress_layer]) // delete the old progress layer
        } catch (e) {
            console.warn(e)
        }
    }
    deleteProgressImageHtml() {
        try {
            // await layer_util.deleteLayers([this.progress_layer]) // delete the old progress layer
            document.getElementById('progressImage').style.width = '0px'
            document.getElementById('progressImage').style.height = '0px'
        } catch (e) {
            console.warn(e)
        }
    }
    async deleteProgressImage() {
        this.deleteProgressImageHtml()
        await this.deleteProgressLayer()
    }
    async setControlNetImage(control_net_index = 0) {
        //check if the selection area is active
        //convert layer to base64
        //the width and height of the exported image

        const width = html_manip.getWidth()
        const height = html_manip.getHeight()

        //get the selection from the canvas as base64 png, make sure to resize to the width and height slider
        const selectionInfo = await psapi.getSelectionInfoExe()
        this.control_net_selection_info = selectionInfo

        const use_silent_mode = html_manip.getUseSilentMode()
        let layer = null
        if (!use_silent_mode) {
            await psapi.snapshot_layerExe()
            const snapshotLayer = await app.activeDocument.activeLayers[0]
            layer = snapshotLayer
        }
        const base64_image =
            await io.IO.getSelectionFromCanvasAsBase64Interface(
                width,
                height,
                layer,
                selectionInfo,
                true,
                use_silent_mode
            )

        await layer_util.deleteLayers([layer]) //delete the snapshot layer if it exists

        this.controlNetImage[control_net_index] = base64_image
        html_manip.setControlImageSrc(
            base64ToBase64Url(base64_image),
            control_net_index
        )
    }
    async hasSessionSelectionChanged() {
        try {
            const isSelectionActive = await psapi.checkIfSelectionAreaIsActive()
            if (isSelectionActive) {
                const current_selection = isSelectionActive // Note: don't use checkIfSelectionAreaIsActive to return the selection object, change this.

                if (
                    await this.hasSelectionChanged(
                        current_selection,
                        this.selectionInfo
                    )
                ) {
                    return true
                } else {
                    //selection has not changed
                    return false
                }
            }
        } catch (e) {
            console.warn(e)
            return false
        }
    }

    async hasSelectionChanged(new_selection, old_selection) {
        if (
            new_selection.left === old_selection.left &&
            new_selection.bottom === old_selection.bottom &&
            new_selection.right === old_selection.right &&
            new_selection.top === old_selection.top
        ) {
            return false
        } else {
            return true
        }
    }

    async selectionEventHandler(event, descriptor){
        try {
            console.log(event, descriptor)

            const isSelectionActive = await psapi.checkIfSelectionAreaIsActive()
            if (isSelectionActive) {
                const current_selection = isSelectionActive // Note: don't use checkIfSelectionAreaIsActive to return the selection object, change this.

                await selection.calcWidthHeightFromSelection()


                if (
                    await this.hasSelectionChanged(
                        current_selection,
                        this.selectionInfo
                    ) //new selection
                ) {
                    const selected_mode = this.getCurrentGenerationModeByValue(GenerationSettings.sd_mode)
                    ui.UI.instance().generateModeUI(selected_mode)
                } else {
                    // it's the same selection and the session is active
                    //indicate that the session will continue. only if the session we are in the same mode as the session's mode
                    // startSessionUI// green color
                    const current_mode = html_manip.getMode()
                    if (
                        this.isActive() && // the session is active
                        this.isSameMode(current_mode) //same mode
                    ) {
                        ui.UI.instance().generateMoreUI()
                    }
                }
            }
        } catch (e) {
            console.warn(e)
        }
    }

    getCurrentGenerationModeByValue(value) {
        for (let key in Enum.generationMode) {
            if (
                Enum.generationMode.hasOwnProperty(key) &&
                Enum.generationMode[key] === value
            ) {
                return key
            }
        }
        return undefined
    }


}

module.exports = {
    GenerationSession,
    GarbageCollectionState,
    SessionState,
}
