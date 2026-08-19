const {DeckGL, OrbitView, PointCloudLayer, LineLayer, TextLayer} = deck;

const lightcurveCache = new Map();
let currentFetchController = null;

function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

async function fetchLightcurve(objectName) {
    if (lightcurveCache.has(objectName)) {
        return lightcurveCache.get(objectName);
    }
    
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();
    
    try {
        const safeName = encodeURIComponent(objectName);
        const response = await fetch(`./data/lightcurves/${safeName}.json?v=1`, {
            signal: currentFetchController.signal
        });
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        lightcurveCache.set(objectName, data);
        return data;
    } catch (e) {
        if (e.name === 'AbortError') return 'aborted';
        console.error('Error fetching lightcurve:', e);
        return null;
    }
}

let currentPlottedObject = null;
let currentMinTime = 0;
let currentMaxTime = 0;

function setupZoomButton() {
    const zoomBtn = document.getElementById('zoom-btn');
    const newZoomBtn = zoomBtn.cloneNode(true);
    zoomBtn.parentNode.replaceChild(newZoomBtn, zoomBtn);
    
    newZoomBtn.addEventListener('click', () => {
        let margin = (currentMaxTime - currentMinTime) * 0.5;
        if (margin === 0) margin = 5;
        Plotly.relayout('lightcurve-plot', {
            'xaxis.range': [currentMinTime - margin, currentMaxTime + margin]
        });
    });
}

function renderLightcurve(data, objectName, minTime, maxTime) {
    const panel = document.getElementById('lightcurve-panel');
    const plotContainer = document.getElementById('lightcurve-plot');
    
    if (!data || !data.bands) {
        // Data failed to load or is invalid
        panel.classList.remove('hidden');
        plotContainer.innerHTML = `<div style="padding: 20px; color: #ff6666; text-align: center;">Failed to load lightcurve data for ${objectName}. It may not exist on the server.</div>`;
        return;
    }
    
    panel.classList.remove('hidden');
    
    currentMinTime = minTime;
    currentMaxTime = maxTime;
    
    let displayMinTime = minTime;
    let displayMaxTime = maxTime;
    if (displayMinTime === displayMaxTime) {
        displayMinTime -= 2;
        displayMaxTime += 2;
    }
    
    let absoluteMinX = Infinity;
    let absoluteMaxX = -Infinity;
    const bands = ['2-3_keV', '3-5_keV', '5-12_keV'];
    
    bands.forEach(band => {
        if (data.bands[band]) {
            const bData = data.bands[band];
            if (bData.bincenter.length > 0) {
                if (bData.bincenter[0] < absoluteMinX) absoluteMinX = bData.bincenter[0];
                if (bData.bincenter[bData.bincenter.length - 1] > absoluteMaxX) absoluteMaxX = bData.bincenter[bData.bincenter.length - 1];
            }
        }
    });

    if (absoluteMinX !== Infinity) {
        // Add a 2% padding based on total span
        const span = absoluteMaxX - absoluteMinX;
        const pad = span > 0 ? span * 0.02 : 5;
        absoluteMinX -= pad;
        absoluteMaxX += pad;
    } else {
        absoluteMinX = null;
        absoluteMaxX = null;
    }
    
    if (currentPlottedObject === objectName) {
        // Fast path: update colors and shapes only
        const colorUpdates = [];
        bands.forEach(band => {
            if (data.bands[band]) {
                const bData = data.bands[band];
                const pointColors = bData.bincenter.map(time => 
                    (time >= minTime && time <= maxTime) ? 'orange' : 'grey'
                );
                colorUpdates.push(pointColors);
            }
        });
        
        Plotly.restyle('lightcurve-plot', { 'marker.color': colorUpdates });
        Plotly.relayout('lightcurve-plot', {
            'shapes[0].x0': displayMinTime,
            'shapes[0].x1': displayMaxTime,
            'xaxis.autorange': true // Show overall lightcurve
        });
        setupZoomButton();
        return;
    }
    
    currentPlottedObject = objectName;
    
    const traces = [];
    
    bands.forEach((band, index) => {
        if (!data.bands[band]) return;
        const bData = data.bands[band];
        
        // Color points grey, except for the hovered epoch window which is orange
        const pointColors = bData.bincenter.map(time => 
            (time >= minTime && time <= maxTime) ? 'orange' : 'grey'
        );
        
        traces.push({
            x: bData.bincenter,
            y: bData.rate,
            error_y: {
                type: 'data',
                array: bData.error,
                visible: true,
                color: 'rgba(255,255,255,0.1)'
            },
            mode: 'markers',
            type: 'scattergl', // Critical for 10k+ points GPU rendering
            marker: { size: 4, color: pointColors },
            name: band,
            xaxis: 'x',
            yaxis: `y${index + 1}`
        });
    });
    
    const layout = {
        title: { text: `${objectName} Lightcurves`, font: { color: '#fff', size: 14 } },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#aaa', size: 10 },
        margin: { l: 40, r: 10, t: 40, b: 30 },
        showlegend: false,
        xaxis: { 
            title: 'Time (MJD)', 
            showgrid: true, 
            gridcolor: '#333', 
            zeroline: false,
            minallowed: absoluteMinX,
            maxallowed: absoluteMaxX
        },
        yaxis: { domain: [0.68, 1], title: '2-3 keV', showgrid: true, gridcolor: '#333', zeroline: false, fixedrange: true },
        yaxis2: { domain: [0.34, 0.66], title: '3-5 keV', showgrid: true, gridcolor: '#333', zeroline: false, fixedrange: true },
        yaxis3: { domain: [0, 0.32], title: '5-12 keV', showgrid: true, gridcolor: '#333', zeroline: false, fixedrange: true },
        shapes: [
            {
                type: 'rect',
                xref: 'x',
                yref: 'paper',
                x0: displayMinTime,
                x1: displayMaxTime,
                y0: 0,
                y1: 1,
                fillcolor: 'rgba(255, 165, 0, 0.2)', // Light transparent orange
                line: { width: 0 },
                layer: 'below'
            }
        ]
    };
    
    Plotly.react('lightcurve-plot', traces, layout, {displayModeBar: false, responsive: true, scrollZoom: true});
    setupZoomButton();

    const plotDiv = document.getElementById('lightcurve-plot');
    if (!plotDiv._hasAutoscaleListener) {
        plotDiv._hasAutoscaleListener = true;
        let isAutoscaling = false;
        plotDiv.on('plotly_relayout', function(eventData) {
            if (isAutoscaling) return;
            
            let minX, maxX;
            if (eventData['xaxis.range[0]'] !== undefined) {
                minX = eventData['xaxis.range[0]'];
                maxX = eventData['xaxis.range[1]'];
            } else if (eventData['xaxis.range']) {
                minX = eventData['xaxis.range'][0];
                maxX = eventData['xaxis.range'][1];
            } else if (eventData['xaxis.autorange']) {
                isAutoscaling = true;
                Plotly.relayout(plotDiv, {
                    'yaxis.autorange': true,
                    'yaxis2.autorange': true,
                    'yaxis3.autorange': true
                }).then(() => { isAutoscaling = false; });
                return;
            } else {
                return;
            }

            const update = {};
            const pData = plotDiv.data;
            if (!pData) return;
            
            for (let i = 0; i < 3; i++) {
                if (!pData[i]) continue;
                const xData = pData[i].x;
                const yData = pData[i].y;
                const eData = pData[i].error_y ? pData[i].error_y.array : null;
                
                let minY = Infinity;
                let maxY = -Infinity;
                
                for (let j = 0; j < xData.length; j++) {
                    const x = xData[j];
                    if (x >= minX && x <= maxX) {
                        const y = yData[j];
                        if (y === null || isNaN(y)) continue;
                        const err = eData ? eData[j] : 0;
                        if (y - err < minY) minY = y - err;
                        if (y + err > maxY) maxY = y + err;
                    }
                }
                
                if (minY !== Infinity && maxY !== -Infinity) {
                    const span = maxY - minY;
                    const pad = span === 0 ? (Math.abs(minY) * 0.1 || 0.1) : span * 0.1;
                    const key = i === 0 ? 'yaxis.range' : `yaxis${i+1}.range`;
                    update[key] = [minY - pad, maxY + pad];
                }
            }
            
            if (Object.keys(update).length > 0) {
                isAutoscaling = true;
                Plotly.relayout(plotDiv, update).then(() => {
                    isAutoscaling = false;
                });
            }
        });
    }
}

const tooltipState = {
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    offsetX: 15,
    offsetY: 15,
    anchor3D: null
};

const state = {
    rawData: [],
    points: [],
    subclasses: new Set(),
    selectedSubclasses: new Set(),
    selectedObjects: new Set(),
    objectsBySubclass: {},
    subclassCheckboxes: {},
    objectPointCounts: {},
    objectProperties: {},
    epochMap: new Map(),
    colorMap: {},
    hoveredEpochId: null,
    lockedEpochId: null, // Track frozen state
    hoverTimeout: null,  // Debounce for hovering off
    colorUpdateCounter: 0,
    bounds: {
        x: {min: Infinity, max: -Infinity},
        y: {min: Infinity, max: -Infinity},
        z: {min: Infinity, max: -Infinity}
    },
    controls: {
        pointSize: 0.01,
        alpha: 255,
        xMin: -Infinity,
        xMax: Infinity,
        yMin: -Infinity,
        yMax: Infinity,
        zMin: -Infinity,
        zMax: Infinity
    }
};

function getColorForSubclass(subclass) {
    const s = subclass.toUpperCase();
    
    // Warm colors for BH (but not BH/NS)
    if (s.includes('BH') && !s.includes('BH/NS')) {
        if (s.includes('LMBH')) return [255, 69, 0];   // Red-Orange
        if (s.includes('HMBH')) return [255, 140, 0];  // Dark Orange
        return [255, 99, 71]; // Tomato
    }
    
    // Cold colors for NS (but not BH/NS)
    if (s.includes('NS') && !s.includes('BH/NS')) {
        if (s.includes('LMNS')) return [30, 144, 255]; // Dodger Blue
        if (s.includes('HMNS')) return [0, 206, 209];  // Dark Turquoise
        return [65, 105, 225]; // Royal Blue
    }
    
    // Green colors for Pulsars
    if (s.includes('PULSAR')) {
        if (s.includes('LMPULSAR')) return [50, 205, 50]; // Lime Green
        if (s.includes('HMPULSAR')) return [34, 139, 34]; // Forest Green
        return [0, 255, 0]; // Lime
    }
    
    // White for BH/NS or Unknowns
    return [255, 255, 255];
}

let currentViewState = {
    target: [0, 0, 0],
    zoom: 8,
    rotationX: 30,
    rotationOrbit: 30
};

let deckgl = new DeckGL({
    container: document.querySelector('.plot-container'),
    views: new OrbitView(),
    viewState: currentViewState,
    controller: true,
    pickingRadius: 10, // Prevent losing hover when mouse slips between points
    onViewStateChange: ({viewState}) => {
        currentViewState = viewState;
        deckgl.setProps({viewState: currentViewState});
    },
    onClick: info => {
        if (state.lockedEpochId) {
            // Force completely unfreeze and clear hover so it returns to full plot
            state.lockedEpochId = null;
            state.hoveredEpochId = null;
            document.getElementById('tooltip').classList.add('hidden');
            document.getElementById('lightcurve-panel').classList.add('hidden');
            updatePlot();
            clearHoverInfo();
            return;
        }

        if (info.object || state.hoveredEpochId) {
            const targetEpochId = info.object ? info.object.epoch_id : state.hoveredEpochId;
            state.lockedEpochId = targetEpochId;
            if (info.coordinate) {
                tooltipState.anchor3D = info.coordinate;
            }
            // Ensure it is hovered
            state.hoveredEpochId = targetEpochId;
            updateHoverInfo(targetEpochId);
            updatePlot();
        }
    },
    layers: []
});

// Tooltip dragging logic
const tooltipElement = document.getElementById('tooltip');
tooltipElement.addEventListener('mousedown', e => {
    // Only allow drag if locked (frozen) so it's stable
    if (state.lockedEpochId) {
        tooltipState.isDragging = true;
        tooltipState.dragStartX = e.clientX;
        tooltipState.dragStartY = e.clientY;
        e.stopPropagation(); // prevent map from panning
        tooltipElement.style.cursor = 'grabbing';
    }
});

  window.addEventListener('mousemove', e => {
      if (tooltipState.isDragging) {
          const dx = e.clientX - tooltipState.dragStartX;
          const dy = e.clientY - tooltipState.dragStartY;
          tooltipState.offsetX += dx;
          tooltipState.offsetY += dy;
          tooltipState.dragStartX = e.clientX;
          tooltipState.dragStartY = e.clientY;
          updateTooltipPosition();
          e.stopPropagation(); // Prevent anything else from handling this drag
      }
  }, {capture: true});

  const stopDrag = () => {
      if (tooltipState.isDragging) {
          tooltipState.isDragging = false;
          tooltipElement.style.cursor = 'move';
      }
  };
  
  window.addEventListener('mouseup', stopDrag, {capture: true});
  window.addEventListener('pointerup', stopDrag, {capture: true});
  window.addEventListener('mouseleave', stopDrag, {capture: true});

document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        const response = await fetch('./data/master_data.json');
        const json = await response.json();
        state.rawData = json.data;
        
        processData();
        setupSliders();
        setupCameraButtons();
        renderFilters();
        syncGlobalCheckboxes();
        document.getElementById('filter-bursters').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            Object.keys(state.objectProperties).forEach(obj => {
                if (state.objectProperties[obj].is_burster) {
                    if (isChecked) state.selectedObjects.add(obj);
                    else state.selectedObjects.delete(obj);
                    
                    if (state.objectProperties[obj].checkboxElement) {
                        state.objectProperties[obj].checkboxElement.checked = isChecked;
                    }
                }
            });
            syncSubclassCheckboxes();
            updatePlot();
        });
        
        document.getElementById('filter-debeurs').addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            Object.keys(state.objectProperties).forEach(obj => {
                if (state.objectProperties[obj].in_de_beurs) {
                    if (isChecked) state.selectedObjects.add(obj);
                    else state.selectedObjects.delete(obj);
                    
                    if (state.objectProperties[obj].checkboxElement) {
                        state.objectProperties[obj].checkboxElement.checked = isChecked;
                    }
                }
            });
            syncSubclassCheckboxes();
            updatePlot();
        });
        
        document.getElementById('btn-check-all').addEventListener('click', () => {
            Object.keys(state.objectProperties).forEach(obj => {
                state.selectedObjects.add(obj);
                if (state.objectProperties[obj].checkboxElement) {
                    state.objectProperties[obj].checkboxElement.checked = true;
                }
            });
            syncSubclassCheckboxes();
            syncGlobalCheckboxes();
            updatePlot();
        });
        
        document.getElementById('btn-clear-all').addEventListener('click', () => {
            state.selectedObjects.clear();
            Object.keys(state.objectProperties).forEach(obj => {
                if (state.objectProperties[obj].checkboxElement) {
                    state.objectProperties[obj].checkboxElement.checked = false;
                }
            });
            syncSubclassCheckboxes();
            syncGlobalCheckboxes();
            updatePlot();
        });
        
        document.getElementById('toggle-sidebar').addEventListener('click', (e) => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('collapsed');
            e.target.innerText = sidebar.classList.contains('collapsed') ? '❯' : '❮';
        });
        
        // Prevent clicks on the tooltip from unfreezing the plot
        const tooltip = document.getElementById('tooltip');
        ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel'].forEach(evt => {
            tooltip.addEventListener(evt, e => e.stopPropagation());
        });
        
        updatePlot();
        
        document.getElementById('loading').classList.add('hidden');
    } catch (error) {
        console.error("Error fetching data:", error);
        document.getElementById('loading').innerText = "Error loading data.";
    }
}

function processData() {
    state.rawData.forEach(obj => {
        const subclass = obj.subclass;
        
        if (!state.objectsBySubclass[subclass]) {
            state.objectsBySubclass[subclass] = new Set();
        }
        
        let totalObjPoints = 0;
        
        if (!state.colorMap[subclass]) {
            state.colorMap[subclass] = getColorForSubclass(subclass);
        }
        
        obj.epochs.forEach(epoch => {
            state.epochMap.set(epoch.epoch_id, {
                object: obj.object,
                class: obj.class,
                subclass: obj.subclass,
                in_de_beurs: obj.in_de_beurs,
                epoch_id: epoch.epoch_id,
                length_days: epoch.length_days,
                points: epoch.points
            });
            
            // Flatten points for Deck.gl
            epoch.points.forEach(p => {
                totalObjPoints++;
                state.bounds.x.min = Math.min(state.bounds.x.min, p.sc);
                state.bounds.x.max = Math.max(state.bounds.x.max, p.sc);
                state.bounds.y.min = Math.min(state.bounds.y.min, p.hc);
                state.bounds.y.max = Math.max(state.bounds.y.max, p.hc);
                state.bounds.z.min = Math.min(state.bounds.z.min, p.relint);
                state.bounds.z.max = Math.max(state.bounds.z.max, p.relint);

                state.points.push({
                    sc: p.sc,
                    hc: p.hc,
                    relint: p.relint,
                    time: p.time,
                    epoch_id: epoch.epoch_id,
                    object: obj.object,
                    subclass: subclass,
                    is_burster: obj.is_burster,
                    in_de_beurs: obj.in_de_beurs,
                    color: state.colorMap[subclass]
                });
            });
        });
        
        if (totalObjPoints > 0) {
            state.objectsBySubclass[subclass].add(obj.object);
            state.selectedObjects.add(obj.object);
            state.objectPointCounts[obj.object] = totalObjPoints;
            state.objectProperties[obj.object] = {
                is_burster: obj.is_burster,
                in_de_beurs: obj.in_de_beurs,
                checkboxElement: null // We will store the DOM element here
            };
            state.subclasses.add(subclass);
            state.selectedSubclasses.add(subclass);
        } 
    });
}

function renderFilters() {
    const container = document.getElementById('subclass-filters');
    container.innerHTML = '';
    
    Array.from(state.subclasses).sort().forEach(subclass => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'subclass-group';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'subclass-header';
        
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-btn';
        toggleBtn.innerHTML = '▶';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = subclass;
        state.subclassCheckboxes[subclass] = checkbox;
        
        const colorIndicator = document.createElement('input');
        colorIndicator.type = 'color';
        colorIndicator.style.display = 'inline-block';
        colorIndicator.style.width = '16px';
        colorIndicator.style.height = '16px';
        colorIndicator.style.margin = '0 5px';
        colorIndicator.style.padding = '0';
        colorIndicator.style.border = 'none';
        colorIndicator.style.cursor = 'pointer';
        colorIndicator.style.backgroundColor = 'transparent';
        
        const rgb = state.colorMap[subclass];
        colorIndicator.value = rgbToHex(rgb[0], rgb[1], rgb[2]);
        
        colorIndicator.addEventListener('input', (e) => {
            const newRgb = hexToRgb(e.target.value);
            state.colorMap[subclass] = newRgb;
            state.points.forEach(p => {
                if (p.subclass === subclass) {
                    p.color = newRgb;
                }
            });
            state.colorUpdateCounter++;
            updatePlot();
        });
        
        headerDiv.appendChild(toggleBtn);
        headerDiv.appendChild(checkbox);
        headerDiv.appendChild(colorIndicator);
        headerDiv.appendChild(document.createTextNode(`${subclass} (${state.objectsBySubclass[subclass].size})`));
        
        groupDiv.appendChild(headerDiv);
        
        const objectListDiv = document.createElement('div');
        objectListDiv.className = 'object-list';
        objectListDiv.style.display = 'none';
        
        toggleBtn.addEventListener('click', () => {
            if (objectListDiv.style.display === 'none') {
                objectListDiv.style.display = 'flex';
                toggleBtn.innerHTML = '▼';
            } else {
                objectListDiv.style.display = 'none';
                toggleBtn.innerHTML = '▶';
            }
        });
        
        const objects = Array.from(state.objectsBySubclass[subclass]).sort();
        const objectCheckboxes = [];
        
        objects.forEach(objName => {
            const objLabel = document.createElement('label');
            objLabel.className = 'object-item';
            
            const objCheckbox = document.createElement('input');
            objCheckbox.type = 'checkbox';
            objCheckbox.checked = true;
            objCheckbox.value = objName;
            
            // Store reference to the checkbox element for global filters to interact with
            state.objectProperties[objName].checkboxElement = objCheckbox;
            
            objCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    state.selectedObjects.add(objName);
                } else {
                    state.selectedObjects.delete(objName);
                }
                
                syncSubclassCheckboxes();
                syncGlobalCheckboxes();
                
                updatePlot();
            });
            
            objectCheckboxes.push(objCheckbox);
            objLabel.appendChild(objCheckbox);
            objLabel.appendChild(document.createTextNode(`${objName} [${state.objectPointCounts[objName]}]`));
            objectListDiv.appendChild(objLabel);
        });
        
        checkbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            objectCheckboxes.forEach(cb => {
                cb.checked = isChecked;
                if (isChecked) {
                    state.selectedObjects.add(cb.value);
                } else {
                    state.selectedObjects.delete(cb.value);
                }
            });
            syncGlobalCheckboxes();
            updatePlot();
        });
        
        groupDiv.appendChild(objectListDiv);
        container.appendChild(groupDiv);
    });
}

function setupSliders() {
    // Basic controls
    const sizeInput = document.getElementById('point-size');
    const alphaInput = document.getElementById('point-alpha');
    const valSize = document.getElementById('val-point-size');
    const valAlpha = document.getElementById('val-point-alpha');

    sizeInput.addEventListener('input', e => {
        state.controls.pointSize = parseFloat(e.target.value);
        valSize.innerText = state.controls.pointSize.toFixed(3);
        updatePlot();
    });
    
    alphaInput.addEventListener('input', e => {
        state.controls.alpha = parseInt(e.target.value);
        valAlpha.innerText = state.controls.alpha;
        updatePlot();
    });

    // Axes Limits
    const axes = [
        { axis: 'x', elMin: 'limit-x-min', elMax: 'limit-x-max', valLabel: 'val-x-range' },
        { axis: 'y', elMin: 'limit-y-min', elMax: 'limit-y-max', valLabel: 'val-y-range' },
        { axis: 'z', elMin: 'limit-z-min', elMax: 'limit-z-max', valLabel: 'val-z-range' }
    ];

    axes.forEach(config => {
        const minInput = document.getElementById(config.elMin);
        const maxInput = document.getElementById(config.elMax);
        const valLabel = document.getElementById(config.valLabel);
        
        const bMin = state.bounds[config.axis].min;
        const bMax = state.bounds[config.axis].max;
        
        // Pad bounds slightly so user can drag comfortably
        const pad = (bMax - bMin) * 0.05 || 0.1;
        const sMin = bMin - pad;
        const sMax = bMax + pad;
        
        minInput.min = sMin;
        minInput.max = sMax;
        minInput.step = (sMax - sMin) / 100;
        minInput.value = sMin;
        
        maxInput.min = sMin;
        maxInput.max = sMax;
        maxInput.step = (sMax - sMin) / 100;
        maxInput.value = sMax;
        
        state.controls[`${config.axis}Min`] = sMin;
        state.controls[`${config.axis}Max`] = sMax;
        
        const updateRange = () => {
            const vMin = parseFloat(minInput.value);
            const vMax = parseFloat(maxInput.value);
            
            // Prevent crossing
            if (vMin > vMax) {
                if (document.activeElement === minInput) minInput.value = vMax;
                else maxInput.value = vMin;
            }
            
            const finalMin = parseFloat(minInput.value);
            const finalMax = parseFloat(maxInput.value);
            
            valLabel.innerText = `[${finalMin.toFixed(2)}, ${finalMax.toFixed(2)}]`;
            
            state.controls[`${config.axis}Min`] = finalMin;
            state.controls[`${config.axis}Max`] = finalMax;
            updatePlot();
        };

        minInput.addEventListener('input', updateRange);
        maxInput.addEventListener('input', updateRange);
        updateRange(); // Set initial labels
    });
}

function setCameraView(rotationX, rotationOrbit, zoom = 10) {
    currentViewState = {
        ...currentViewState,
        target: [0, 0, 0],
        zoom: zoom,
        rotationX: rotationX,
        rotationOrbit: rotationOrbit,
        transitionDuration: 500
    };
    deckgl.setProps({viewState: currentViewState});
}

function setupCameraButtons() {
    document.getElementById('btn-recenter').addEventListener('click', () => {
        setCameraView(30, 30, 8); // Slightly zoomed out recenter
    });
    document.getElementById('btn-hc-sc').addEventListener('click', () => {
        // Y vs X (HC vertical, SC horizontal)
        // Look from top
        setCameraView(90, 0, 7);
    });
    document.getElementById('btn-hc-relint').addEventListener('click', () => {
        // Z vs Y (RelInt vertical, HC horizontal)
        // Look from side (-X)
        setCameraView(0, -90, 7);
    });
    document.getElementById('btn-sc-relint').addEventListener('click', () => {
        // Z vs X (RelInt vertical, SC horizontal)
        // Look from front (-Y)
        setCameraView(0, 0, 7);
    });
}

function getTicks(min, max) {
    const span = max - min;
    let step = 0.5;
    if (span <= 0.1) step = 0.02;
    else if (span <= 0.5) step = 0.1;
    else if (span <= 1.0) step = 0.2;
    else if (span <= 2.5) step = 0.5;
    else if (span <= 5.0) step = 1.0;
    else step = Math.pow(10, Math.floor(Math.log10(span)));
    
    const start = Math.floor(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step/2; v += step) {
        ticks.push(v);
    }
    return ticks;
}

function syncSubclassCheckboxes() {
    Array.from(state.subclasses).forEach(subclass => {
        const checkbox = state.subclassCheckboxes[subclass];
        if (!checkbox) return;
        
        const objects = Array.from(state.objectsBySubclass[subclass]);
        if (objects.length > 0) {
            const allChecked = objects.every(obj => state.selectedObjects.has(obj));
            const noChecked = objects.every(obj => !state.selectedObjects.has(obj));
            
            checkbox.checked = !noChecked;
            checkbox.indeterminate = !allChecked && !noChecked;
        }
    });
}

function syncGlobalCheckboxes() {
    const bursters = Object.keys(state.objectProperties).filter(obj => state.objectProperties[obj].is_burster);
    if (bursters.length > 0) {
        const allBurstersChecked = bursters.every(obj => state.selectedObjects.has(obj));
        const noBurstersChecked = bursters.every(obj => !state.selectedObjects.has(obj));
        const bursterEl = document.getElementById('filter-bursters');
        bursterEl.checked = !noBurstersChecked;
        bursterEl.indeterminate = !allBurstersChecked && !noBurstersChecked;
    }
    
    // For de Beurs, it behaves identically according to user "This is also true for the show de Beurs only button"
    const debeurs = Object.keys(state.objectProperties).filter(obj => state.objectProperties[obj].in_de_beurs);
    if (debeurs.length > 0) {
        const allDebeursChecked = debeurs.every(obj => state.selectedObjects.has(obj));
        const noDebeursChecked = debeurs.every(obj => !state.selectedObjects.has(obj));
        const debeursEl = document.getElementById('filter-debeurs');
        debeursEl.checked = !noDebeursChecked;
        debeursEl.indeterminate = !allDebeursChecked && !noDebeursChecked;
    }
}

function updatePlot() {
    const filteredPoints = state.points.filter(p => {
        // Physically remove unhovered points to prevent WebGL depth-buffer blocking
        const activeEpoch = state.lockedEpochId || state.hoveredEpochId;
        if (activeEpoch && p.epoch_id !== activeEpoch) return false;
        
        return state.selectedObjects.has(p.object) &&
            p.sc >= state.controls.xMin && p.sc <= state.controls.xMax &&
            p.hc >= state.controls.yMin && p.hc <= state.controls.yMax &&
            p.relint >= state.controls.zMin && p.relint <= state.controls.zMax;
    });
    
    const axesLines = [];
    const axesTexts = [];

    // Provide safe defaults if no bounds (e.g. initial empty load)
    const minX = state.bounds.x.min === Infinity ? 0 : state.bounds.x.min;
    const maxX = state.bounds.x.max === -Infinity ? 1 : state.bounds.x.max;
    const minY = state.bounds.y.min === Infinity ? 0 : state.bounds.y.min;
    const maxY = state.bounds.y.max === -Infinity ? 1 : state.bounds.y.max;
    const minZ = state.bounds.z.min === Infinity ? 0 : state.bounds.z.min;
    const maxZ = state.bounds.z.max === -Infinity ? 1 : state.bounds.z.max;

    const origin = [
        Math.min(0, minX) - 0.1,
        Math.min(0, minY) - 0.1,
        Math.min(0, minZ) - 0.1
    ];

    const xTicks = getTicks(minX, maxX);
    const yTicks = getTicks(minY, maxY);
    const zTicks = getTicks(minZ, maxZ);

    // X Axis
    const xEnd = [maxX + 0.1, origin[1], origin[2]];
    axesLines.push({src: origin, tgt: xEnd, color: [255, 100, 100]});
    axesTexts.push({pos: [maxX + 0.2, origin[1], origin[2]], label: 'SC (X)', color: [255, 100, 100], size: 16});
    xTicks.forEach(t => {
        axesLines.push({src: [t, origin[1], origin[2]], tgt: [t, origin[1] - 0.05, origin[2]], color: [255, 100, 100]});
        axesTexts.push({pos: [t, origin[1] - 0.08, origin[2]], label: t.toFixed(2).replace(/\.?0+$/, ''), color: [200, 200, 200], size: 12});
    });

    // Y Axis
    const yEnd = [origin[0], maxY + 0.1, origin[2]];
    axesLines.push({src: origin, tgt: yEnd, color: [100, 255, 100]});
    axesTexts.push({pos: [origin[0], maxY + 0.2, origin[2]], label: 'HC (Y)', color: [100, 255, 100], size: 16});
    yTicks.forEach(t => {
        axesLines.push({src: [origin[0], t, origin[2]], tgt: [origin[0] - 0.05, t, origin[2]], color: [100, 255, 100]});
        axesTexts.push({pos: [origin[0] - 0.08, t, origin[2]], label: t.toFixed(2).replace(/\.?0+$/, ''), color: [200, 200, 200], size: 12});
    });

    // Z Axis
    const zEnd = [origin[0], origin[1], maxZ + 0.1];
    axesLines.push({src: origin, tgt: zEnd, color: [100, 100, 255]});
    axesTexts.push({pos: [origin[0], origin[1], maxZ + 0.2], label: 'RelInt (Z)', color: [100, 100, 255], size: 16});
    zTicks.forEach(t => {
        axesLines.push({src: [origin[0], origin[1], t], tgt: [origin[0] - 0.05, origin[1], t], color: [100, 100, 255]});
        axesTexts.push({pos: [origin[0] - 0.08, origin[1], t], label: t.toFixed(2).replace(/\.?0+$/, ''), color: [200, 200, 200], size: 12});
    });

    const layers = [
        new LineLayer({
            id: 'axes-lines',
            data: axesLines,
            getSourcePosition: d => d.src,
            getTargetPosition: d => d.tgt,
            getColor: d => d.color,
            getWidth: 2,
            widthUnits: 'pixels'
        }),
        new TextLayer({
            id: 'axes-labels',
            data: axesTexts,
            getPosition: d => d.pos,
            getText: d => d.label,
            getSize: d => d.size,
            getColor: d => d.color,
            getAlignmentBaseline: 'center',
            getTextAnchor: 'middle',
            billboard: true
        }),
        new PointCloudLayer({
            id: 'base-points',
            data: filteredPoints,
            getPosition: d => [d.sc, d.hc, d.relint],
            getColor: d => [...d.color, state.controls.alpha],
            pointSize: state.controls.pointSize,
            sizeUnits: 'common',
            pickable: true,
            autoHighlight: false,
            pickingRadius: 5,
            onHover: info => {
                if (state.lockedEpochId) return; // Frozen!
                
                if (info.object && info.object.epoch_id !== state.hoveredEpochId) {
                    if (state.hoverTimeout) {
                       if (state.lockedEpochId !== info.object.epoch_id) {
                        clearTimeout(state.hoverTimeout);
                    }
                    state.hoverTimeout = null;
                    }
                    state.hoveredEpochId = info.object.epoch_id;
                    tooltipState.anchor3D = info.coordinate;
                    tooltipState.offsetX = 15;
                    tooltipState.offsetY = 15;
                    updateHoverInfo(info.object.epoch_id);
                    updatePlot(); // Re-render layers with highlight
                } else if (!info.object && state.hoveredEpochId) {
                    if (!state.hoverTimeout) {
                        state.hoverTimeout = setTimeout(() => {
                            if (!state.lockedEpochId) {
                                state.hoveredEpochId = null;
                                clearHoverInfo();
                                updatePlot();
                            }
                            state.hoverTimeout = null;
                        }, 100); // 100ms debounce
                    }
                }
            },
            updateTriggers: {
                getColor: [state.hoveredEpochId, state.controls.alpha, state.colorUpdateCounter]
            }
        })
    ];

    if (state.hoveredEpochId) {
        const epochData = state.epochMap.get(state.hoveredEpochId);
        if (epochData) {
            const sortedPoints = [...epochData.points].sort((a, b) => a.time - b.time);
            
            const minTime = sortedPoints[0].time;
            const maxTime = sortedPoints[sortedPoints.length - 1].time;
            const timeRange = maxTime - minTime || 1;
            
            const lineSegments = [];
            for (let i = 0; i < sortedPoints.length - 1; i++) {
                const p1 = sortedPoints[i];
                const p2 = sortedPoints[i+1];
                const ratio = timeRange === 0 ? 0 : (p1.time - minTime) / timeRange;
                
                // Color gradient from Blue (early) to Red (late)
                const color = [Math.floor(255 * ratio), 50, Math.floor(255 * (1 - ratio)), 255];
                
                lineSegments.push({
                    src: [p1.sc, p1.hc, p1.relint],
                    tgt: [p2.sc, p2.hc, p2.relint],
                    color: color
                });
            }

            layers.push(
                new LineLayer({
                    id: 'highlight-lines',
                    data: lineSegments,
                    getSourcePosition: d => d.src,
                    getTargetPosition: d => d.tgt,
                    getColor: d => d.color,
                    getWidth: 3,
                    widthUnits: 'pixels'
                }),
                new PointCloudLayer({
                    id: 'highlight-points',
                    data: sortedPoints,
                    getPosition: d => [d.sc, d.hc, d.relint],
                    getColor: d => {
                        const minTime = sortedPoints[0].time;
                        const maxTime = sortedPoints[sortedPoints.length - 1].time;
                        const timeRange = maxTime - minTime || 1;
                        const ratio = timeRange === 0 ? 0 : (d.time - minTime) / timeRange;
                        return [Math.floor(255 * ratio), 50, Math.floor(255 * (1 - ratio)), 255]; 
                    },
                    pointSize: state.controls.pointSize,
                    sizeUnits: 'common'
                })
            );
        }
    }

    deckgl.setProps({layers});
}

function updateTooltipPosition() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip && !tooltip.classList.contains('hidden') && tooltipState.anchor3D) {
        const viewports = deckgl.getViewports();
        if (viewports.length > 0) {
            const screenCoords = viewports[0].project(tooltipState.anchor3D);
            tooltip.style.left = (screenCoords[0] + tooltipState.offsetX) + 'px';
            tooltip.style.top = (screenCoords[1] + tooltipState.offsetY) + 'px';
        }
    }
}

function tooltipLoop() {
    if (state.lockedEpochId || state.hoveredEpochId) {
        updateTooltipPosition();
    }
    requestAnimationFrame(tooltipLoop);
}
requestAnimationFrame(tooltipLoop);

async function updateHoverInfo(epochId) {
    const epochData = state.epochMap.get(epochId);
    if (!epochData) return;
    
    const tooltip = document.getElementById('tooltip');
    
    // Add freeze indicator if locked
    const freezeStatus = state.lockedEpochId === epochId ? '<span style="color: #ffaa00; font-weight: bold; float: right;">[FROZEN]</span>' : '';
    
    tooltip.innerHTML = `
        <h3>Epoch Details ${freezeStatus}</h3>
        <p><strong>Object:</strong> ${epochData.object}</p>
        <p><strong>Class:</strong> ${epochData.class}</p>
        <p><strong>Subclass:</strong> ${epochData.subclass}</p>
        <p><strong>De Beurs Object:</strong> ${epochData.in_de_beurs ? 'Yes' : 'No'}</p>
        <p><strong>Epoch ID:</strong> ${epochId}</p>
        <p><strong>Length:</strong> ${epochData.length_days.toFixed(1)} days</p>
        <p><strong>Points in Epoch:</strong> ${epochData.points.length}</p>
        <div style="margin-top: 15px; margin-bottom: 5px;">
            <div style="font-size: 0.85em; display: flex; justify-content: space-between; margin-bottom: 3px; color: #ccc;">
                <span>Early</span>
                <span>Late</span>
            </div>
            <div style="height: 8px; width: 100%; border-radius: 4px; background: linear-gradient(to right, rgb(0,50,255), rgb(255,50,0));"></div>
        </div>
        <button onclick="window.showLightcurve('${epochId}')" style="margin-top:10px; width:100%; padding: 5px; cursor: pointer; border: 1px solid #555; background: #333; color: white; border-radius: 4px;">See Lightcurve</button>
    `;
    
    // Allow interactions with tooltip content if locked
    tooltip.style.pointerEvents = state.lockedEpochId === epochId ? 'auto' : 'none';
    tooltip.style.cursor = state.lockedEpochId === epochId ? 'move' : 'default';
    
    tooltip.classList.remove('hidden');
}

window.showLightcurve = async function(epochId) {
    const epochData = state.epochMap.get(epochId);
    if (!epochData) return;
    
    const sortedPoints = [...epochData.points].sort((a, b) => a.time - b.time);
    const minTime = sortedPoints[0].time;
    const maxTime = sortedPoints[sortedPoints.length - 1].time;
    
    const panel = document.getElementById('lightcurve-panel');
    const plotContainer = document.getElementById('lightcurve-plot');
    const loadingIndicator = document.getElementById('lightcurve-loading');
    panel.classList.remove('hidden');
    loadingIndicator.classList.remove('hidden');
    plotContainer.style.opacity = '0.3';
    
    const tooltipBtn = document.querySelector('#tooltip button');
    if (tooltipBtn) {
        tooltipBtn.innerText = 'Loading...';
        tooltipBtn.style.opacity = '0.5';
    }
    
    // Fetch and render lightcurve
    const rawData = await fetchLightcurve(epochData.object);
    
    loadingIndicator.classList.add('hidden');
    plotContainer.style.opacity = '1.0';
    
    if (tooltipBtn) {
        tooltipBtn.innerText = 'See Lightcurve';
        tooltipBtn.style.opacity = '1';
    }
    
    if (rawData === 'aborted') return; // Ignore aborted fetches
    renderLightcurve(rawData, epochData.object, minTime, maxTime);
};

function moveHoverTooltip(x, y) {
    const tooltip = document.getElementById('tooltip');
    if (tooltip && !tooltip.classList.contains('hidden')) {
        // Offset the tooltip slightly from the cursor
        tooltip.style.left = (x + 15) + 'px';
        tooltip.style.top = (y + 15) + 'px';
    }
}

function clearHoverInfo() {
    document.getElementById('tooltip').classList.add('hidden');
    document.getElementById('lightcurve-panel').classList.add('hidden');
    currentPlottedObject = null; // Ensure panel renders correctly if reopened
}
