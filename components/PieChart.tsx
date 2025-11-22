import React from 'react';

interface PieChartDataItem {
  name: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartDataItem[];
  title: string;
}

const PieChart: React.FC<PieChartProps> = ({ data, title }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (total === 0) {
    return (
      <div className="w-full bg-gray-800/80 backdrop-blur-sm p-4 rounded-lg border border-gray-700 shadow-lg">
        <h2 className="text-xl font-bold text-center text-white mb-2">{title}</h2>
        <div className="flex items-center justify-center h-48 text-gray-400">
          Nenhuma entrada registrada para exibir.
        </div>
      </div>
    );
  }

  const gradientParts = data.reduce((acc, item, index) => {
    const percentage = (item.value / total) * 100;
    const end = acc.cumulative + percentage;
    const part = `${item.color} ${acc.cumulative}% ${end}%`;
    acc.cumulative = end;
    acc.parts.push(part);
    return acc;
  }, { cumulative: 0, parts: [] as string[] });

  const conicGradient = `conic-gradient(${gradientParts.parts.join(', ')})`;

  return (
    <div className="w-full bg-gray-800/80 backdrop-blur-sm p-4 rounded-lg border border-gray-700 shadow-lg">
      <h2 className="text-xl font-bold text-center text-white mb-4">{title}</h2>
      <div className="grid grid-cols-2 gap-4 items-center">
        <div 
          className="w-40 h-40 rounded-full mx-auto" 
          style={{ background: conicGradient }}
          role="img"
          aria-label={`Pie chart showing: ${data.map(d => `${d.name} ${((d.value/total)*100).toFixed(1)}%`).join(', ')}`}
        />
        <div className="space-y-2">
          {data.map(item => {
            const percentage = ((item.value / total) * 100).toFixed(1);
            return (
              <div key={item.name} className="flex items-center">
                <div 
                  className="w-3 h-3 rounded-full mr-2" 
                  style={{ backgroundColor: item.color }}
                />
                <div>
                  <p className="text-sm font-semibold text-white">{item.name}</p>
                  <p className="text-xs text-gray-400">{item.value} entradas ({percentage}%)</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PieChart;
