const {DeckGL, OrbitView, PointCloudLayer, LineLayer, TextLayer} = deck;

const lightcurveCache = new Map();
let currentFetchController = null;

async function fetchLightcurve(objectName) {
    if (lightcurveCache.has(objectName)) {
        return lightcurveCache.get(objectName);
    }
    
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();
    
    try {
        const response = await fetch(`./data/lightcurves/${encodeURIComponent(objectName)}.json`, {
            signal: currentFetchController.signal
        });
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        lightcurveCache.set(objectName, data);
        return data;
    } catch (e) {
        if (e.name === 'AbortError') return null;
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
    if (!data || !data.bands) {
        panel.classList.add('hidden');
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

const state = {
    rawData: [],
    points: [],
    subclasses: new Set(),
    selectedSubclasses: new Set(),
    epochMap: new Map(),
    colorMap: {},
    hoveredEpochId: null,
    lockedEpochId: null, // Track frozen state
    hoverTimeout: null,  // Debounce for hovering off
    bounds: {
        x: {min: Infinity, max: -Infinity},
        y: {min: Infinity, max: -Infinity},
        z: {min: Infinity, max: -Infinity}
    },
    controls: {
        pointSize: 1.5,
        alpha: 255,
        xMin: -Infinity,
        xMax: Infinity,
        yMin: -Infinity,
        yMax: Infinity,
        zMin: -Infinity,
        zMax: Infinity
    }
};

const deBeursSources = new Set([
    'LMC_X-3', 'LMC_X-1', 'MAXI_J1535-571', 'GX_339-4', 'GRS_1739-278', 
    'H_1743-322', 'MAXI_J1820+070', 'GRS_1915+105', 'Cyg_X-1', '4U_1957+115', 
    'Cyg_X-3', 'H_0614+091', '4U_1254-690', 'Cir_X-1', '4U_1608-52', 'Sco_X-1', 
    'H_1636-536', 'GX_349+2', 'GX_9+9', 'GX_3+1', 'GX_5-1', 'GX_9+1', 'GX_13+1', 
    'GX_17+2', 'Ser_X-1', 'HETE_J1900.1-2455', 'Aql_X-1', '4U_1916-053', 
    'Cyg_X-2', '1A_0535+262', '4U_1626-67'
]);

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
    zoom: 10,
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
            clearHoverInfo();
            updatePlot();
        } else if (info.object) {
            // Lock the epoch
            state.lockedEpochId = info.object.epoch_id;
            if (state.hoverTimeout) {
                clearTimeout(state.hoverTimeout);
                state.hoverTimeout = null;
            }
            // Ensure it is hovered
            if (state.hoveredEpochId !== info.object.epoch_id) {
                state.hoveredEpochId = info.object.epoch_id;
                updateHoverInfo(info.object.epoch_id, info.x, info.y);
            }
            updatePlot();
        }
    },
    layers: []
});

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
        document.getElementById('filter-bursters').addEventListener('change', updatePlot);
        document.getElementById('filter-debeurs').addEventListener('change', updatePlot);
        
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
        state.subclasses.add(subclass);
        state.selectedSubclasses.add(subclass);
        
        if (!state.colorMap[subclass]) {
            state.colorMap[subclass] = getColorForSubclass(subclass);
        }
        
        obj.epochs.forEach(epoch => {
            state.epochMap.set(epoch.epoch_id, {
                object: obj.object,
                class: obj.class,
                subclass: obj.subclass,
                epoch_id: epoch.epoch_id,
                length_days: epoch.length_days,
                points: epoch.points
            });
            
            // Flatten points for Deck.gl
            epoch.points.forEach(p => {
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
                    color: state.colorMap[subclass]
                });
            });
        });
    });
}

function renderFilters() {
    const container = document.getElementById('subclass-filters');
    container.innerHTML = '';
    
    Array.from(state.subclasses).sort().forEach(subclass => {
        const label = document.createElement('label');
        label.className = 'filter-label';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.value = subclass;
        checkbox.addEventListener('change', handleFilterChange);
        
        const colorIndicator = document.createElement('span');
        colorIndicator.style.display = 'inline-block';
        colorIndicator.style.width = '12px';
        colorIndicator.style.height = '12px';
        
        const rgb = state.colorMap[subclass];
        colorIndicator.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        colorIndicator.style.borderRadius = '50%';
        
        label.appendChild(checkbox);
        label.appendChild(colorIndicator);
        label.appendChild(document.createTextNode(subclass));
        
        container.appendChild(label);
    });
}

function handleFilterChange(e) {
    const subclass = e.target.value;
    if (e.target.checked) {
        state.selectedSubclasses.add(subclass);
    } else {
        state.selectedSubclasses.delete(subclass);
    }
    updatePlot();
}

function setupSliders() {
    // Basic controls
    const sizeInput = document.getElementById('point-size');
    const alphaInput = document.getElementById('point-alpha');
    const valSize = document.getElementById('val-point-size');
    const valAlpha = document.getElementById('val-point-alpha');

    sizeInput.addEventListener('input', e => {
        state.controls.pointSize = parseFloat(e.target.value);
        valSize.innerText = state.controls.pointSize.toFixed(1);
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

function updatePlot() {
    const showBursters = document.getElementById('filter-bursters').checked;
    const showDeBeurs = document.getElementById('filter-debeurs').checked;
    
    const filteredPoints = state.points.filter(p => {
        if (!showBursters && p.is_burster) return false;
        if (showDeBeurs && !deBeursSources.has(p.object)) return false;
        
        // Physically remove unhovered points to prevent WebGL depth-buffer blocking
        const activeEpoch = state.lockedEpochId || state.hoveredEpochId;
        if (activeEpoch && p.epoch_id !== activeEpoch) return false;
        
        return state.selectedSubclasses.has(p.subclass) &&
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
            pickable: true,
            autoHighlight: false,
            pickingRadius: 5,
            onHover: info => {
                if (state.lockedEpochId) return; // Frozen!
                
                if (info.object && info.object.epoch_id !== state.hoveredEpochId) {
                    if (state.hoverTimeout) {
                        clearTimeout(state.hoverTimeout);
                        state.hoverTimeout = null;
                    }
                    state.hoveredEpochId = info.object.epoch_id;
                    updateHoverInfo(info.object.epoch_id, info.x, info.y);
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
                getColor: [state.hoveredEpochId, state.controls.alpha]
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
                        const ratio = timeRange === 0 ? 0 : (d.time - minTime) / timeRange;
                        return [Math.floor(255 * ratio), 50, Math.floor(255 * (1 - ratio)), 255]; 
                    },
                    pointSize: 4
                })
            );
        }
    }

    deckgl.setProps({layers});
}

async function updateHoverInfo(epochId, x, y) {
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
        <p><strong>Epoch ID:</strong> ${epochId}</p>
        <p><strong>Length:</strong> ${epochData.length_days.toFixed(1)} days</p>
        <p><strong>Points in Epoch:</strong> ${epochData.points.length}</p>
        <button onclick="window.showLightcurve('${epochId}')" style="margin-top:10px; width:100%; padding: 5px; cursor: pointer; border: 1px solid #555; background: #333; color: white; border-radius: 4px;">See Lightcurve</button>
    `;
    
    // Allow clicking the button ONLY when frozen, otherwise it blocks hover logic
    tooltip.style.pointerEvents = state.lockedEpochId === epochId ? 'auto' : 'none';
    
    tooltip.classList.remove('hidden');
    moveHoverTooltip(x, y);
}

window.showLightcurve = async function(epochId) {
    const epochData = state.epochMap.get(epochId);
    if (!epochData) return;
    
    const sortedPoints = [...epochData.points].sort((a, b) => a.time - b.time);
    const minTime = sortedPoints[0].time;
    const maxTime = sortedPoints[sortedPoints.length - 1].time;
    
    // Fetch and render lightcurve
    const rawData = await fetchLightcurve(epochData.object);
    if (!rawData) return; // Ignore aborted fetches
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
