import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Controls, Background, MiniMap, Node, Edge, useNodesState, useEdgesState, MarkerType, Panel, useReactFlow, ReactFlowProvider, getNodesBounds, getViewportForBounds } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import { Download, Maximize, Minimize } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext'; // fallback to darkmode awareness

interface CognitiveMapViewProps {
  data: {
    nodes: any[];
    edges: any[];
  }
}

const nodeColor = (type: string, level: number, isDark: boolean) => {
  if (isDark) {
    if (type === 'chapter') return '#1e3a8a'; // slate/blue dark
    if (type === 'concept') return '#064e3b'; // slate/green dark
    return '#334155'; // slate-700
  }
  if (type === 'chapter') return '#bfdbfe'; // blue-200
  if (type === 'concept') return '#bbf7d0'; // green-200
  return '#e2e8f0'; // gray-200
};

const nodeBorder = (isDark: boolean) => isDark ? '#475569' : '#94a3b8';
const nodeTextColor = (isDark: boolean) => isDark ? '#f8fafc' : '#0f172a';

// Dagre Layout Initialization
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 300, height: 120 }); // Wider spacing for rich text
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = { ...node };

    newNode.position = {
      x: nodeWithPosition.x - 150,
      y: nodeWithPosition.y - 60,
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
};

const FlowDownloadButton = () => {
  const { getNodes } = useReactFlow();

  const handleDownload = () => {
    const nodes = getNodes();
    if (nodes.length === 0) return;
    
    // We capture the exact viewport of all nodes so no text is cut off
    const nodesBounds = getNodesBounds(nodes);
    const imageWidth = nodesBounds.width + 100;
    const imageHeight = nodesBounds.height + 100;
    const transform = getViewportForBounds(nodesBounds, imageWidth, imageHeight, 0.2, 2, 0);

    const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewportElement) return;

    toPng(viewportElement, {
      backgroundColor: 'transparent', // Make background transparent if wanted, or matching theme
      width: imageWidth,
      height: imageHeight,
      pixelRatio: 2,
      style: {
        width: `${imageWidth}px`,
        height: `${imageHeight}px`,
        transform: `translate(${transform.x + 50}px, ${transform.y + 50}px) scale(${transform.zoom})`,
      },
    }).then((dataUrl) => {
      const link = document.createElement('a');
      link.download = 'cognitive-map.png';
      link.href = dataUrl;
      link.click();
    });
  };

  return (
    <button onClick={handleDownload} className="p-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" title="Download Image">
      <Download size={18} />
    </button>
  );
};

const CognitiveMapInner: React.FC<CognitiveMapViewProps> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      wrapperRef.current?.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const initialNodes: Node[] = useMemo(() => {
    return (data.nodes || []).map((n) => {
      const isChapter = n.type === 'chapter';
      return {
        id: n.id,
        position: { x: 0, y: 0 },
        data: { 
          label: (
            <div className="flex flex-col items-start gap-1 text-left w-full h-full">
              <div className="flex flex-row justify-between w-full">
                <span className="font-bold flex-1">{n.label}</span>
                {n.section && <span className="text-[10px] opacity-70 ml-2 whitespace-nowrap bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded h-min">{n.section}</span>}
              </div>
              {n.description && <span className="text-[10px] mt-1 opacity-80 leading-tight">{n.description}</span>}
            </div>
          ) 
        },
        style: {
          background: nodeColor(n.type, n.level, isDark),
          border: `1px solid ${nodeBorder(isDark)}`,
          color: nodeTextColor(isDark),
          borderRadius: '8px',
          padding: '12px',
          fontSize: isChapter ? '14px' : '12px',
          width: 250,
          boxShadow: isDark ? '0 4px 6px -1px rgba(0, 0, 0, 0.5)' : '0 1px 3px rgba(0,0,0,0.1)',
        },
      };
    });
  }, [data.nodes, isDark]);

  const initialEdges: Edge[] = useMemo(() => {
    return (data.edges || []).map((e, index) => ({
      id: `e-${e.source}-${e.target}-${index}`,
      source: e.source,
      target: e.target,
      label: e.label || e.type,
      animated: true,
      style: { stroke: isDark ? '#64748b' : '#94a3b8' },
      labelStyle: { fill: isDark ? '#cbd5e1' : '#475569', fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: isDark ? '#1e293b' : '#ffffff', fillOpacity: 0.8 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isDark ? '#64748b' : '#94a3b8',
      },
    }));
  }, [data.edges, isDark]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Apply layout
  useEffect(() => {
    if (initialNodes.length > 0) {
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        initialNodes,
        initialEdges,
        'LR' // Left to Right
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (!data || !data.nodes || data.nodes.length === 0) {
    return <div className="text-gray-500 dark:text-gray-400 text-sm">No cognitive map data to display.</div>;
  }

  return (
    <div ref={wrapperRef} className={`relative flex flex-col items-center justify-center transition-all duration-300 ${isFullscreen ? 'w-screen h-screen bg-slate-50 dark:bg-slate-900 z-50 fixed inset-0' : 'w-full h-[500px] border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-900/50 overflow-hidden'}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        colorMode={isDark ? 'dark' : 'light'}
        proOptions={{ hideAttribution: true }}
        className="w-full h-full"
      >
        <Controls />
        <Background gap={16} size={1} color={isDark ? '#334155' : '#cbd5e1'} />
        <MiniMap zoomable pannable nodeColor={(node) => isDark ? '#475569' : '#e2e8f0'} maskColor={isDark ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.6)'} />
        <Panel position="top-right" className="flex gap-2 p-2">
          <FlowDownloadButton />
          <button onClick={toggleFullscreen} className="p-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
};

export const CognitiveMapView: React.FC<CognitiveMapViewProps> = (props) => {
  return (
    <ReactFlowProvider>
      <CognitiveMapInner {...props} />
    </ReactFlowProvider>
  );
};

