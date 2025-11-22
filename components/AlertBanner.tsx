// FIX: Implement the AlertBanner component, resolving "Cannot find name" errors.
import React from 'react';

interface AlertBannerProps {
  message: string;
  type: 'info' | 'warning' | 'error';
}

const AlertBanner: React.FC<AlertBannerProps> = ({ message, type }) => {
  const baseClasses = 'w-full text-center p-3 text-white font-semibold rounded-lg shadow-md';
  const typeClasses = {
    info: 'bg-blue-600',
    warning: 'bg-yellow-500 text-gray-800',
    error: 'bg-red-600',
  };

  return (
    <div className={`${baseClasses} ${typeClasses[type]}`}>
      {message}
    </div>
  );
};

export default AlertBanner;
