const { executeAsModal } = require('photoshop').core
const batchPlay = require('photoshop').action.batchPlay
const app = window.require('photoshop').app

function finalWidthHeight(
    selectionWidth,
    selectionHeight,
    minWidth,
    minHeight
) {
    let finalWidth = 0
    let finalHeight = 0

    if (selectionWidth <= selectionHeight) {
        //do operation on the smaller dimension
        const scaleRatio = selectionWidth / minWidth

        finalWidth = minWidth
        finalHeight = selectionHeight / scaleRatio
    } else {
        const scaleRatio = selectionHeight / minHeight

        finalHeight = minHeight
        finalWidth = selectionWidth / scaleRatio
    }
    return [finalWidth, finalHeight]
}

async function selectionToFinalWidthHeight() {
    try {
        const selectionInfo = await Selection.getSelectionInfoExe()
        const [finalWidth, finalHeight] = finalWidthHeight(
            selectionInfo.width,
            selectionInfo.height,
            512,
            512
        )

        return [
            parseInt(finalWidth),
            parseInt(finalHeight),
            selectionInfo.width,
            selectionInfo.height,
        ]
    } catch (e) {
        console.warn('you need a rectangular selection', e)
    }
}

async function selectBoundingBox() {
    let l = await app.activeDocument.activeLayers[0]
    let bounds = await l.boundsNoEffects
    let selectionInfo = convertSelectionObjectToSelectionInfo(bounds)
    await reSelectMarqueeExe(selectionInfo)
    return selectionInfo
}
async function reSelectMarqueeExe(selectionInfo) {
    try {
        if (Selection.isSelectionValid(selectionInfo)) {
            //only try to reactivate the selection area if it is valid
            await executeAsModal(async () => {
                await reSelectMarqueeCommand(selectionInfo)
            })
        }
    } catch (e) {
        console.warn(e)
    }
}

async function reSelectMarqueeCommand(selectionInfo) {
    const result = await batchPlay(
        [
            {
                _obj: 'set',
                _target: [
                    {
                        _ref: 'channel',
                        _property: 'selection',
                    },
                ],
                to: {
                    _obj: 'rectangle',
                    top: {
                        _unit: 'pixelsUnit',
                        _value: selectionInfo.top,
                    },
                    left: {
                        _unit: 'pixelsUnit',
                        _value: selectionInfo.left,
                    },
                    bottom: {
                        _unit: 'pixelsUnit',
                        _value: selectionInfo.bottom,
                    },
                    right: {
                        _unit: 'pixelsUnit',
                        _value: selectionInfo.right,
                    },
                },
                _options: {
                    dialogOptions: 'dontDisplay',
                },
            },
        ],
        {
            synchronousExecution: true,
            modalBehavior: 'execute',
        }
    )
}

function convertSelectionObjectToSelectionInfo(selection_obj) {
    let selection_info = {
        left: selection_obj._left,
        right: selection_obj._right,
        bottom: selection_obj._bottom,
        top: selection_obj._top,
        height: selection_obj._bottom - selection_obj._top,
        width: selection_obj._right - selection_obj._left,
    }
    return selection_info
}

const SelectionInfoDesc = () => ({
    _obj: 'get',
    _target: [
        {
            _property: 'selection',
        },
        {
            _ref: 'document',
            _id: app.activeDocument._id,
        },
    ],
    _options: {
        dialogOptions: 'dontDisplay',
    },
})
class Selection {
    static async getSelectionInfoExe() {
        try {
            const selection = (
                await executeAsModal(Selection.getSelectionInfoCommand)
            )[0].selection

            if (Selection.isSelectionValid(selection)) {
                let selection_info = {
                    left: selection.left._value,
                    right: selection.right._value,
                    bottom: selection.bottom._value,
                    top: selection.top._value,
                    height: selection.bottom._value - selection.top._value,
                    width: selection.right._value - selection.left._value,
                }
                // console.dir({selection_info})
                return selection_info
            }
        } catch (e) {
            console.warn('selection info error', e)
        }
    }
    static async getSelectionInfoCommand() {
        const result = await batchPlay(
            [
                {
                    _obj: 'get',
                    _target: [
                        {
                            _property: 'selection',
                        },
                        {
                            _ref: 'document',
                            _id: app.activeDocument._id,
                        },
                    ],
                    _options: {
                        dialogOptions: 'dontDisplay',
                    },
                },
            ],
            {
                synchronousExecution: true,
                modalBehavior: 'execute',
            }
        )

        return result
    }

    static isSelectionValid(selection) {
        if (
            selection && // check if the selection is defined
            selection.hasOwnProperty('left') &&
            selection.hasOwnProperty('right') &&
            selection.hasOwnProperty('top') &&
            selection.hasOwnProperty('bottom')
        ) {
            return true
        }

        return false
    }

    static reselectArea(selection_info) {}
    static isSameSelection(selection_info_1, selection_info_2) {}

    static {}
}
module.exports = {
    finalWidthHeight,
    selectionToFinalWidthHeight,
    selectBoundingBox,
    convertSelectionObjectToSelectionInfo,
    Selection,
    reSelectMarqueeExe,
}
