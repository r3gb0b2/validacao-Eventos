

import React from 'react';
import { AnalyticsData } from '../types';

interface AnalyticsChartProps {
  data: AnalyticsData;
  sectorNames: string[];
}

// --- SVG Path Generation Helper ---
// This function calculates control points and generates a smooth cubic bezier path string
const getSvgPath = (points: { x: number; y: number }[], smoothing: number, height: number): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${height} L ${points[0].x},${points[0].y} L ${points[0].x},${height} Z`;

  const controlPoint = (current: any, previous: any, next: any, reverse?: boolean) => {
    const p = previous || current;
    const n = next || current;
    const o = {
      length: Math.sqrt(Math.pow(n.x - p.x, 2) + Math.pow(n.y - p.y, 2)),
      angle: Math.atan2(n.y - p.y, n.x - p.x),
    };
    const angle = o.angle + (reverse ? Math.PI : 0);
    const length = o.length * smoothing;
    const x = current.x + Math.cos(angle) * length;
    const y = current.y + Math.sin(angle) * length;
    return [x, y];
  };

  const pathData = points.map((point, i, a) => {
    if (i === 0) {
      return `M ${point.x},${point.y}`;
    }
    const [cpsX, cpsY] = controlPoint(a[i - 1], a[i - 2], point);
    const [cpeX, cpeY] = controlPoint(point, a[i - 1], a[i + 1], true);
    return `C ${cpsX},${cpsY} ${cpeX},${cpeY} ${point.x},${point.y}`;
  });

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  return `${pathData.join(' ')} L ${lastPoint.x},${height} L ${firstPoint.x},${height} Z`;
};


const AnalyticsChart: React.FC<AnalyticsChartProps> = ({ data, sectorNames }) => {
  const { timeBuckets, peak } = data;

  if (!timeBuckets || timeBuckets.length === 0) {
    return (
      <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
        Ainda não há dados de validação para exibir no gráfico.
      </div>
    );
  }
  
  const CHART_WIDTH = 1000;
  const CHART_HEIGHT = 288; // h-72
  const SMOOTHING = 0.2;

  const maxCount = Math.max(...timeBuckets.map(b => b.total), 1);
  const points = timeBuckets.map((bucket, index) => ({
      x: (index / (timeBuckets.length - 1)) * CHART_WIDTH,
      y: CHART_HEIGHT - (bucket.total / maxCount) * CHART_HEIGHT,
      time: bucket.time,
      total: bucket.total,
      counts: bucket.counts
  }));
  
  const path = getSvgPath(points, SMOOTHING, CHART_HEIGHT);
  const sectorTextColors = ['text-blue-400', 'text-teal-400', 'text-purple-400', 'text-pink-400', 'text-fuchsia-400', 'text-sky-400'];

  return (
    <div className="w-full bg-gray-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold text-white mb-4">Entradas a Cada 30 Minutos</h3>
      
      {/* Chart Area */}
      <div className="relative h-72 w-full">
         <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
             <defs>
                <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.05" />
                </linearGradient>
            </defs>
             <path d={path} fill="url(#area-gradient)" stroke="#f97316" strokeWidth="2" />
         </svg>
         
         {/* Interaction Layer for Tooltips */}
         <div className="absolute inset-0 flex">
             {points.map((point) => {
                 const isPeak = point.time === peak.time;
                 return (
                    <div key={point.time} className="flex-1 group relative flex items-end justify-center">
                        {isPeak && (
                           <div className="absolute top-0 w-px h-full bg-orange-500/50" style={{ transform: `translateY(${point.y}px)` }}>
                               <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-orange-400"></div>
                           </div>
                        )}
                         {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 w-36 bg-gray-900 text-white text-xs rounded py-1 px-2 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 border border-gray-600 shadow-lg">
                            <p className="font-bold">{point.time}</p>
                            <hr className="border-gray-600 my-1"/>
                             {sectorNames.map((sector, index) => (
                                <p key={sector} className="text-left"><span className={sectorTextColors[index % sectorTextColors.length]}>{sector}:</span> {point.counts[sector] || 0}</p>
                             ))}
                            <hr className="border-gray-600 my-1"/>
                            <p className="font-bold text-left">Total: {point.total}</p>
                        </div>
                    </div>
                 )
             })}
         </div>

         {/* X-Axis Labels */}
         <div className="absolute -bottom-5 inset-x-0 flex justify-between">
            {timeBuckets.map((bucket, index) => {
                // Show fewer labels on smaller screens if too cluttered
                if (timeBuckets.length > 10 && index % 2 !== 0 && timeBuckets.length > 15) return null;
                return (
                    <span key={bucket.time} className="text-xs text-gray-400" style={{ transform: `translateX(${(index / (timeBuckets.length - 1)) * 100}%)`}}>
                        {bucket.time}
                    </span>
                );
            })}
         </div>
      </div>
    </div>
  );
};

export default AnalyticsChart;