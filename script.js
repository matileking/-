let simulation, svg, width, height, zoom;
let linkElements, nodeElements, labelElements, linkLabelElements;
let allNodes = [], allLinks = [];
let currentTransform = d3.zoomIdentity;
let contextMenuNode = null;

const NODE_COLORS = {
    "Vulnerability": "#ff6b6b",
    "Product": "#4ecdc4",
    "CVE": "#ffe66d",
    "Vendor": "#1a535c",
    "VulnType": "#ff9f1c",
    "Severity": "#9b5de5",
    "Unknown": "#95a5a6"
};

const LABEL_MAP = {
    "Vulnerability": "漏洞",
    "Product": "产品",
    "CVE": "CVE",
    "Vendor": "厂商",
    "VulnType": "漏洞类型",
    "Severity": "严重程度"
};

document.addEventListener('DOMContentLoaded', function() {
    initGraph();
    loadData();
    setupSearch();
    setupFilters();
    setupZoomControls();
    setupTabs();
    setupContextMenu();
    setupSidebarToggle();
    setupKeyboardShortcuts();
    setupResetHighlight();
});

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function initGraph() {
    const container = document.getElementById('graph-container');
    width = container.clientWidth;
    height = container.clientHeight;

    svg = d3.select('#graph-container')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .on('click', () => {
            hideContextMenu();
            resetHighlight();
        });

    zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            currentTransform = event.transform;
            svg.select('.graph-content').attr('transform', event.transform);
        });

    svg.call(zoom);
    svg.append('g').attr('class', 'graph-content');

    window.addEventListener('resize', () => {
        width = container.clientWidth;
        height = container.clientHeight;
        svg.attr('width', width).attr('height', height);
        if (simulation) {
            simulation.force('center', d3.forceCenter(width / 2, height / 2));
            simulation.alpha(0.3).restart();
        }
    });
}

function loadData() {
    d3.json('data/graph.json').then(data => {
        console.log('数据加载成功:', data);
        allNodes = data.nodes || [];
        allLinks = data.links || [];
        
        allNodes.forEach(n => {
            n.color = n.color || NODE_COLORS[n.group] || NODE_COLORS.Unknown;
            n.size = n.size || 20;
        });
        
        allLinks.forEach(l => {
            if (typeof l.source === 'string') {
                l.source = allNodes.find(n => n.id === l.source) || l.source;
            }
            if (typeof l.target === 'string') {
                l.target = allNodes.find(n => n.id === l.target) || l.target;
            }
        });
        
        updateStats(allNodes.length, allLinks.length);
        renderGraph(allNodes, allLinks);
        updateSearchResults(allNodes);
        updateAboutStats();
        
        setTimeout(hideLoading, 300);
        
    }).catch(err => {
        console.error('加载数据失败:', err);
        hideLoading();
        document.getElementById('graph-container').innerHTML = 
            '<div class="error-msg">❌ 数据加载失败<br><br>请检查 data/graph.json 文件是否存在<br>路径: ' + new URL('data/graph.json', window.location.href).href + '<br><br>提示：请通过本地服务器打开（如 python -m http.server 或 Live Server）</div>';
    });
}

function renderGraph(nodes, links) {
    const container = svg.select('.graph-content');
    container.selectAll('*').remove();

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-400).distanceMax(600))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => (d.size || 20) + 15));

    const linkGroup = container.append('g').attr('class', 'links');
    
    linkElements = linkGroup.selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'link')
        .attr('stroke', '#4a90d9')
        .attr('stroke-opacity', 0.4)
        .attr('stroke-width', 1.5)
        .on('mouseover', function(event, d) {
            d3.select(this).attr('stroke-opacity', 0.9).attr('stroke', '#00d4ff').attr('stroke-width', 2.5);
            showLinkTooltip(event, d);
        })
        .on('mouseout', function(event, d) {
            if (!d3.select(this).classed('highlighted')) {
                d3.select(this).attr('stroke-opacity', 0.4).attr('stroke', '#4a90d9').attr('stroke-width', 1.5);
            }
            hideLinkTooltip();
        });

    const linkLabelGroup = container.append('g').attr('class', 'link-labels');
    
    linkLabelElements = linkLabelGroup.selectAll('g')
        .data(links)
        .enter()
        .append('g');
    
    linkLabelElements.append('rect')
        .attr('class', 'link-label-bg')
        .attr('rx', 4)
        .attr('ry', 4);
    
    linkLabelElements.append('text')
        .attr('class', 'link-label')
        .text(d => d.relation || '')
        .attr('dy', '0.35em');

    nodeElements = container.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended))
        .on('click', (event, d) => {
            event.stopPropagation();
            selectNode(d);
        })
        .on('contextmenu', (event, d) => {
            event.preventDefault();
            showContextMenu(event, d);
        })
        .on('mouseover', (event, d) => {
            showNodeTooltip(event, d);
        })
        .on('mouseout', () => {
            hideNodeTooltip();
        });

    nodeElements.append('circle')
        .attr('r', d => d.size || 20)
        .attr('fill', d => d.color || NODE_COLORS[d.group] || NODE_COLORS.Unknown)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))');

    labelElements = container.append('g')
        .attr('class', 'labels')
        .selectAll('text')
        .data(nodes)
        .enter()
        .append('text')
        .attr('class', 'node-label')
        .text(d => d.name.length > 10 ? d.name.substring(0, 8) + '...' : d.name)
        .attr('x', 0)
        .attr('y', d => (d.size || 20) + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#e0e0e0')
        .attr('font-size', '11px')
        .attr('font-weight', '500')
        .style('pointer-events', 'none')
        .style('text-shadow', '0 1px 3px rgba(0,0,0,0.8)');

    simulation.on('tick', () => {
        linkElements
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);

        labelElements
            .attr('x', d => d.x)
            .attr('y', d => d.y + (d.size || 20) + 14);

        linkLabelElements.each(function(d) {
            const g = d3.select(this);
            const mx = (d.source.x + d.target.x) / 2;
            const my = (d.source.y + d.target.y) / 2;
            const text = g.select('text');
            const bbox = text.node().getBBox();
            g.select('rect')
                .attr('x', mx - bbox.width / 2 - 4)
                .attr('y', my - bbox.height / 2 - 2)
                .attr('width', bbox.width + 8)
                .attr('height', bbox.height + 4);
            text.attr('x', mx).attr('y', my);
        });
    });
}

function selectNode(node) {
    showNodeDetails(node);
    highlightNode(node);
}

function highlightNode(selectedNode) {
    nodeElements.selectAll('circle').attr('opacity', 0.25).attr('stroke-width', 1);
    linkElements.classed('highlighted', false).attr('stroke-opacity', 0.1).attr('stroke', '#999').attr('stroke-width', 1);
    linkLabelElements.style('opacity', 0.1);

    nodeElements.filter(d => d.id === selectedNode.id)
        .selectAll('circle').attr('opacity', 1).attr('stroke-width', 4).attr('stroke', '#ffd700');

    const connectedIds = new Set([selectedNode.id]);
    linkElements.each(function(d) {
        if (d.source.id === selectedNode.id || d.target.id === selectedNode.id) {
            d3.select(this).classed('highlighted', true)
                .attr('stroke-opacity', 1).attr('stroke', '#ffd700').attr('stroke-width', 2.5);
            connectedIds.add(d.source.id);
            connectedIds.add(d.target.id);
        }
    });

    linkLabelElements.each(function(d) {
        if (d.source.id === selectedNode.id || d.target.id === selectedNode.id) {
            d3.select(this).style('opacity', 1);
        }
    });

    nodeElements.filter(d => connectedIds.has(d.id) && d.id !== selectedNode.id)
        .selectAll('circle').attr('opacity', 1).attr('stroke-width', 2.5);
}

function resetHighlight() {
    if (!nodeElements) return;
    nodeElements.selectAll('circle').attr('opacity', 1).attr('stroke-width', 2).attr('stroke', '#fff');
    linkElements.classed('highlighted', false).attr('stroke-opacity', 0.4).attr('stroke', '#4a90d9').attr('stroke-width', 1.5);
    linkLabelElements.style('opacity', 1);
}

function setupResetHighlight() {
    document.getElementById('reset-highlight').addEventListener('click', resetHighlight);
}

function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function showNodeTooltip(event, d) {
    const tooltip = document.getElementById('node-tooltip');
    const typeLabel = LABEL_MAP[d.group] || d.group;
    const degree = allLinks.filter(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        return sid === d.id || tid === d.id;
    }).length;
    
    tooltip.innerHTML = `
        <div class="tooltip-name">${d.name}</div>
        <span class="tooltip-type" style="background:${d.color}">${typeLabel}</span>
        <div class="tooltip-info">ID: ${d.id}</div>
        <div class="tooltip-info">连接数: ${degree}</div>
    `;
    
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
}

function hideNodeTooltip() {
    document.getElementById('node-tooltip').style.display = 'none';
}

function showLinkTooltip(event, d) {
    const tooltip = document.getElementById('link-tooltip');
    tooltip.textContent = d.relation || '关联';
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
}

function hideLinkTooltip() {
    document.getElementById('link-tooltip').style.display = 'none';
}

function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    searchInput.addEventListener('input', debounce(() => {
        updateSearchResults(allNodes, searchInput.value);
    }, 200));
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function updateSearchResults(nodes, keyword = '') {
    const list = document.getElementById('search-results-list');
    if (!list) return;
    
    const filtered = keyword ? nodes.filter(n => 
        (n.name && n.name.toLowerCase().includes(keyword.toLowerCase())) ||
        (n.id && String(n.id).toLowerCase().includes(keyword.toLowerCase())) ||
        (n.group && n.group.toLowerCase().includes(keyword.toLowerCase()))
    ) : nodes.slice(0, 50);
    
    list.innerHTML = filtered.map(n => `
        <div class="search-result-item" data-id="${n.id}">
            <span class="search-result-dot" style="background:${n.color}"></span>
            <span class="search-result-name">${n.name}</span>
            <span class="search-result-type">${LABEL_MAP[n.group] || n.group}</span>
        </div>
    `).join('');
    
    list.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const nodeId = item.getAttribute('data-id');
            const node = allNodes.find(n => n.id === nodeId);
            if (node) {
                selectNode(node);
                focusOnNode(node);
            }
        });
    });
}

function performSearch() {
    const keyword = document.getElementById('search-input').value.trim();
    const resultDiv = document.getElementById('search-result');
    
    if (!keyword) {
        resultDiv.textContent = '';
        resetHighlight();
        nodeElements.style('display', 'block');
        linkElements.style('display', 'block');
        linkLabelElements.style('display', 'block');
        updateSearchResults(allNodes);
        return;
    }
    
    const matched = allNodes.filter(n => 
        (n.name && n.name.toLowerCase().includes(keyword.toLowerCase())) ||
        (n.id && String(n.id).toLowerCase().includes(keyword.toLowerCase())) ||
        (n.group && n.group.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    if (matched.length === 0) {
        resultDiv.textContent = '未找到匹配结果';
        resultDiv.style.color = '#ff6b6b';
        return;
    }
    
    resultDiv.textContent = `找到 ${matched.length} 个结果`;
    resultDiv.style.color = '#4ecdc4';
    
    updateSearchResults(allNodes, keyword);
    
    const matchedIds = new Set(matched.map(n => n.id));
    nodeElements.style('opacity', d => matchedIds.has(d.id) ? 1 : 0.15);
    linkElements.style('opacity', d => 
        matchedIds.has(d.source.id) && matchedIds.has(d.target.id) ? 1 : 0.05
    );
    linkLabelElements.style('opacity', d => 
        matchedIds.has(d.source.id) && matchedIds.has(d.target.id) ? 1 : 0.05
    );
    
    if (matched.length > 0) {
        focusOnNode(matched[0]);
    }
}

function setupFilters() {
    const checkboxes = document.querySelectorAll('.filter-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', applyFilters);
    });
    
    document.getElementById('select-all')?.addEventListener('click', () => {
        checkboxes.forEach(cb => cb.checked = true);
        applyFilters();
    });
    
    document.getElementById('select-none')?.addEventListener('click', () => {
        checkboxes.forEach(cb => cb.checked = false);
        applyFilters();
    });
}

function applyFilters() {
    const checkedTypes = Array.from(document.querySelectorAll('.filter-checkbox:checked')).map(cb => cb.value);

    nodeElements.style('display', d => checkedTypes.includes(d.group) ? 'block' : 'none');
    
    linkElements.style('display', d => {
        const sourceVisible = checkedTypes.includes(d.source.group);
        const targetVisible = checkedTypes.includes(d.target.group);
        return sourceVisible && targetVisible ? 'block' : 'none';
    });
    
    linkLabelElements.style('display', d => {
        const sourceVisible = checkedTypes.includes(d.source.group);
        const targetVisible = checkedTypes.includes(d.target.group);
        return sourceVisible && targetVisible ? 'block' : 'none';
    });
}

function setupZoomControls() {
    document.getElementById('zoom-in').addEventListener('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.3);
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    });
    
    document.getElementById('zoom-fit').addEventListener('click', () => {
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    });
}

function setupTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const viewName = tab.getAttribute('data-view');
            if (viewName === 'graph') showGraphView();
            else if (viewName === 'stats') showStatsView();
            else if (viewName === 'about') showAboutView();
        });
    });
}

function showGraphView() {
    document.getElementById('graph-view').style.display = 'flex';
    document.getElementById('stats-view').style.display = 'none';
    document.getElementById('about-view').style.display = 'none';
}

function showStatsView() {
    document.getElementById('graph-view').style.display = 'none';
    document.getElementById('stats-view').style.display = 'block';
    document.getElementById('about-view').style.display = 'none';
    renderStats();
}

function showAboutView() {
    document.getElementById('graph-view').style.display = 'none';
    document.getElementById('stats-view').style.display = 'none';
    document.getElementById('about-view').style.display = 'block';
    updateAboutStats();
}

function renderStats() {
    const kpiContainer = document.getElementById('stats-kpi');
    if (!kpiContainer || allNodes.length === 0) return;
    
    const typeCounts = {};
    allNodes.forEach(n => { typeCounts[n.group] = (typeCounts[n.group] || 0) + 1; });
    
    const relCounts = {};
    allLinks.forEach(l => { relCounts[l.relation] = (relCounts[l.relation] || 0) + 1; });
    
    const degreeMap = {};
    allLinks.forEach(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        degreeMap[sid] = (degreeMap[sid] || 0) + 1;
        degreeMap[tid] = (degreeMap[tid] || 0) + 1;
    });
    const avgDegree = allNodes.length > 0 ? (allLinks.length * 2 / allNodes.length).toFixed(2) : 0;
    const maxDegree = Object.keys(degreeMap).length > 0 ? Math.max(...Object.values(degreeMap)) : 0;
    
    kpiContainer.innerHTML = `
        <div class="kpi-card"><div class="kpi-value">${allNodes.length}</div><div class="kpi-label">总节点</div></div>
        <div class="kpi-card"><div class="kpi-value">${allLinks.length}</div><div class="kpi-label">总关系</div></div>
        <div class="kpi-card"><div class="kpi-value">${Object.keys(typeCounts).length}</div><div class="kpi-label">节点类型</div></div>
        <div class="kpi-card"><div class="kpi-value">${Object.keys(relCounts).length}</div><div class="kpi-label">关系类型</div></div>
        <div class="kpi-card"><div class="kpi-value">${avgDegree}</div><div class="kpi-label">平均度数</div></div>
        <div class="kpi-card"><div class="kpi-value">${maxDegree}</div><div class="kpi-label">最大度数</div></div>
    `;
    
    renderPieChart(document.getElementById('chart-nodes'), typeCounts, NODE_COLORS);
    renderBarChart(document.getElementById('chart-links'), relCounts);
    
    const degreeList = Object.entries(degreeMap)
        .map(([id, deg]) => {
            const node = allNodes.find(n => n.id === id);
            return { name: node ? node.name : id, degree: deg, color: node ? node.color : '#95a5a6' };
        })
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 10);
    
    renderDegreeChart(document.getElementById('chart-degree'), degreeList);
}

function renderPieChart(container, data, colorMap) {
    container.innerHTML = '';
    const w = container.clientWidth || 400;
    const h = 300;
    const radius = Math.min(w, h) / 2 - 30;
    
    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${w} ${h}`);
    const g = svg.append('g').attr('transform', `translate(${w/2 - 60},${h/2})`);
    
    const pie = d3.pie().value(d => d[1]).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius);
    const arcHover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius + 8);
    
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, d) => sum + d[1], 0);
    
    g.selectAll('path')
        .data(pie(entries))
        .enter()
        .append('path')
        .attr('d', arc)
        .attr('fill', d => colorMap[d.data[0]] || '#95a5a6')
        .attr('stroke', 'var(--bg-card)')
        .attr('stroke-width', 2)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            d3.select(this).transition().duration(200).attr('d', arcHover);
        })
        .on('mouseout', function(event, d) {
            d3.select(this).transition().duration(200).attr('d', arc);
        });
    
    const legend = svg.append('g').attr('transform', `translate(${w/2 + 50}, 30)`);
    entries.forEach((d, i) => {
        const ly = i * 28;
        legend.append('circle').attr('cx', 0).attr('cy', ly).attr('r', 6).attr('fill', colorMap[d[0]] || '#95a5a6');
        legend.append('text').attr('x', 14).attr('y', ly + 4).attr('fill', '#e0e6ed').attr('font-size', '12px')
            .text(`${LABEL_MAP[d[0]] || d[0]}: ${d[1]} (${(d[1]/total*100).toFixed(1)}%)`);
    });
    
    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em').attr('fill', '#00d4ff').attr('font-size', '24px').attr('font-weight', '800').text(total);
}

function renderBarChart(container, data) {
    container.innerHTML = '';
    const w = container.clientWidth || 400;
    const h = 300;
    const margin = { top: 20, right: 30, bottom: 60, left: 120 };
    
    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${w} ${h}`);
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const maxVal = Math.max(...entries.map(d => d[1]));
    
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, w - margin.left - margin.right]);
    const yScale = d3.scaleBand().domain(entries.map(d => d[0])).range([0, h - margin.top - margin.bottom]).padding(0.3);
    
    const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    
    chart.selectAll('rect').data(entries).enter().append('rect')
        .attr('x', 0).attr('y', d => yScale(d[0])).attr('width', 0).attr('height', yScale.bandwidth())
        .attr('fill', '#4a90d9').attr('rx', 4)
        .transition().duration(800).attr('width', d => xScale(d[1]));
    
    chart.selectAll('.y-label').data(entries).enter().append('text')
        .attr('class', 'y-label').attr('x', -10).attr('y', d => yScale(d[0]) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em').attr('text-anchor', 'end').attr('fill', '#8b9bb4').attr('font-size', '12px')
        .text(d => d[0].length > 12 ? d[0].substring(0, 10) + '...' : d[0]);
    
    chart.selectAll('.value-label').data(entries).enter().append('text')
        .attr('x', d => xScale(d[1]) + 6).attr('y', d => yScale(d[0]) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em').attr('fill', '#e0e6ed').attr('font-size', '12px').text(d => d[1]);
}

function renderDegreeChart(container, data) {
    container.innerHTML = '';
    const w = container.clientWidth || 800;
    const h = 300;
    const margin = { top: 20, right: 30, bottom: 40, left: 200 };
    
    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${w} ${h}`);
    const maxVal = Math.max(...data.map(d => d.degree));
    
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, w - margin.left - margin.right]);
    const yScale = d3.scaleBand().domain(data.map(d => d.name)).range([0, h - margin.top - margin.bottom]).padding(0.3);
    
    const chart = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    
    chart.selectAll('rect').data(data).enter().append('rect')
        .attr('x', 0).attr('y', d => yScale(d.name)).attr('width', 0).attr('height', yScale.bandwidth())
        .attr('fill', d => d.color).attr('rx', 4)
        .transition().duration(800).attr('width', d => xScale(d.degree));
    
    chart.selectAll('.y-label').data(data).enter().append('text')
        .attr('x', -10).attr('y', d => yScale(d.name) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em').attr('text-anchor', 'end').attr('fill', '#e0e6ed').attr('font-size', '12px')
        .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
    
    chart.selectAll('.value-label').data(data).enter().append('text')
        .attr('x', d => xScale(d.degree) + 6).attr('y', d => yScale(d.name) + yScale.bandwidth() / 2)
        .attr('dy', '0.35em').attr('fill', '#e0e6ed').attr('font-size', '12px').text(d => d.degree);
}

function updateAboutStats() {
    const el = document.getElementById('about-stats');
    if (!el) return;
    if (allNodes.length === 0) {
        el.textContent = '数据未加载';
        return;
    }
    el.innerHTML = `当前图谱包含 <strong style="color:#00d4ff">${allNodes.length}</strong> 个节点，<strong style="color:#00d4ff">${allLinks.length}</strong> 条关系`;
}

function setupContextMenu() {
    document.addEventListener('click', hideContextMenu);
    
    document.getElementById('ctx-expand').addEventListener('click', () => {
        if (contextMenuNode) expandNode(contextMenuNode);
        hideContextMenu();
    });
    
    document.getElementById('ctx-focus').addEventListener('click', () => {
        if (contextMenuNode) focusOnNode(contextMenuNode);
        hideContextMenu();
    });
    
    document.getElementById('ctx-hide').addEventListener('click', () => {
        if (contextMenuNode) hideNode(contextMenuNode);
        hideContextMenu();
    });
    
    document.getElementById('ctx-details').addEventListener('click', () => {
        if (contextMenuNode) selectNode(contextMenuNode);
        hideContextMenu();
    });
}

function showContextMenu(event, node) {
    contextMenuNode = node;
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    
    let left = event.pageX;
    let top = event.pageY;
    if (left + 180 > window.innerWidth) left = window.innerWidth - 190;
    if (top + 150 > window.innerHeight) top = window.innerHeight - 160;
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    const nameEl = document.getElementById('ctx-node-name');
    nameEl.textContent = node.name;
    nameEl.title = node.name;
}

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
    contextMenuNode = null;
}

function expandNode(node) {
    const neighborIds = new Set([node.id]);
    allLinks.forEach(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        if (sid === node.id) neighborIds.add(tid);
        if (tid === node.id) neighborIds.add(sid);
    });
    
    nodeElements.style('display', d => neighborIds.has(d.id) ? 'block' : 'none');
    linkElements.style('display', d => {
        const s = d.source.id || d.source;
        const t = d.target.id || d.target;
        return neighborIds.has(s) && neighborIds.has(t) ? 'block' : 'none';
    });
    linkLabelElements.style('display', d => {
        const s = d.source.id || d.source;
        const t = d.target.id || d.target;
        return neighborIds.has(s) && neighborIds.has(t) ? 'block' : 'none';
    });
}

function focusOnNode(node) {
    svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity.translate(width/2, height/2).scale(2).translate(-node.x, -node.y)
    );
}

function hideNode(node) {
    const newNodes = allNodes.filter(n => n.id !== node.id);
    const newLinks = allLinks.filter(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        return sid !== node.id && tid !== node.id;
    });
    renderGraph(newNodes, newLinks);
}

function showNodeDetails(node) {
    const panel = document.getElementById('node-details');
    const typeLabel = LABEL_MAP[node.group] || node.group;
    
    const degree = allLinks.filter(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        return sid === node.id || tid === node.id;
    }).length;
    
    const connectedLinks = allLinks.filter(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        return sid === node.id || tid === node.id;
    });
    
    let html = `
        <div class="detail-header">
            <div class="detail-type-badge" style="background:${node.color}">${typeLabel}</div>
            <h3>${node.name}</h3>
        </div>
        <div class="detail-meta">
            <p><span class="detail-label">ID:</span> <code>${node.id}</code> <button class="copy-btn" onclick="copyToClipboard('${node.id}')">📋</button></p>
            <p><span class="detail-label">连接数:</span> ${degree}</p>
        </div>
    `;
    
    if (node.properties && Object.keys(node.properties).length > 0) {
        html += '<div class="detail-section"><h4>属性</h4><table class="props-table">';
        for (const [key, value] of Object.entries(node.properties)) {
            html += `<tr><td class="prop-key">${key}</td><td class="prop-value">${value}</td></tr>`;
        }
        html += '</table></div>';
    }
    
    if (connectedLinks.length > 0) {
        html += `<div class="detail-section"><h4>关联 (${connectedLinks.length})</h4>`;
        connectedLinks.forEach(l => {
            const sid = l.source.id || l.source;
            const otherNode = sid === node.id ? l.target : l.source;
            const other = otherNode.id ? allNodes.find(n => n.id === otherNode.id) || otherNode : otherNode;
            const direction = sid === node.id ? '→' : '←';
            const otherColor = other.color || NODE_COLORS[other.group] || NODE_COLORS.Unknown;
            html += `
                <div class="related-item" onclick="selectNodeById('${other.id}')">
                    <span class="related-dot" style="background:${otherColor}"></span>
                    <span class="related-name">${other.name}</span>
                    <span class="related-rel">${direction} ${l.relation} ${direction}</span>
                </div>
            `;
        });
        html += '</div>';
    }
    
    panel.innerHTML = html;
}

function selectNodeById(nodeId) {
    const node = allNodes.find(n => n.id === nodeId);
    if (node) {
        selectNode(node);
        focusOnNode(node);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('已复制: ' + text);
    });
}

function setupSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (toggle && sidebar) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            toggle.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
        });
    }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            resetHighlight();
            hideContextMenu();
        }
        if (e.key === 'r' || e.key === 'R') {
            svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
        }
        if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
    });
}

function updateStats(nodeCount, linkCount) {
    document.getElementById('node-count').textContent = nodeCount;
    document.getElementById('link-count').textContent = linkCount;
}

window.selectNodeById = selectNodeById;
window.copyToClipboard = copyToClipboard;