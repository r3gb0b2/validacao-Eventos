import React from 'react';
import { AnalyticsData } from '../types';

interface AnalyticsChartProps {
  data: AnalyticsData;
  sectorNames: string[];
}

const AnalyticsChart: React.FC<AnalyticsChartProps> = ({ data, sectorNames }) => {
  const { timeBuckets, peak } = data;

  if (timeBuckets.length === 0) {
    return (
      <div className="text-center text-gray-400 py-10 bg-gray-800 rounded-lg">
        Ainda não há dados de validação para exibir no gráfico.
      </div>
    );
  }

  const maxCount = Math.max(...timeBuckets.map(b => b.total), 1);
  const sectorColors = ['bg-blue-500', 'bg-teal-500', 'bg-purple-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-sky-500'];
  const sectorTextColors = ['text-blue-400', 'text-teal-400', 'text-purple-400', 'text-pink-400', 'text-fuchsia-400', 'text-sky-400'];


  return (
    <div className="w-full bg-gray-800 p-4 rounded-lg">
      <h3 className="text-lg font-semibold text-white mb-4">Entradas a Cada 10 Minutos</h3>
      <div className="flex items-end h-72 space-x-2 border-l-2 border-b-2 border-gray-600 pl-2 pb-1">
        {timeBuckets.map((bucket) => {
          const isPeak = bucket.time === peak.time;
          return (
            <div key={bucket.time} className="flex-1 flex flex-col items-center h-full justify-end relative group">
              <div
                className={`w-full flex flex-col-reverse rounded-t-md ${isPeak ? 'bg-orange-600/30' : 'bg-gray-700'}`}
                style={{ height: `${(bucket.total / maxCount) * 100}%` }}
              >
                {sectorNames.map((sector, index) => {
                  const sectorCount = bucket.counts[sector] || 0;
                  if (sectorCount === 0) return null;
                  const sectorHeight = (sectorCount / bucket.total) * 100;
                  return (
                    <div
                      key={sector}
                      className={`${sectorColors[index % sectorColors.length]}`}
                      style={{ height: `${sectorHeight}%` }}
                    />
                  );
                })}
              </div>
              <span className="text-xs text-gray-400 mt-1 absolute -bottom-5">{bucket.time}</span>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 w-32 bg-gray-900 text-white text-xs rounded py-1 px-2 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <p className="font-bold">{bucket.time}</p>
                 {sectorNames.map((sector, index) => (
                    <p key={sector}><span className={sectorTextColors[index % sectorTextColors.length]}>{sector}:</span> {bucket.counts[sector] || 0}</p>
                 ))}
                <hr className="border-gray-600 my-1"/>
                <p>Total: {bucket.total}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end flex-wrap gap-x-4 gap-y-2 mt-4">
          {sectorNames.map((sector, index) => (
            <div key={sector} className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${sectorColors[index % sectorColors.length]}`}></div>
                <span className="text-sm text-gray-300">{sector}</span>
            </div>
          ))}
      </div>
    </div>
  );
};

export default AnalyticsChart;