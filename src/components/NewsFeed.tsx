/**
 * News Feed Panel
 * Financial news feed with filtering, impact indicators, and symbol integration
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
import { useNewsStore, type NewsCategory, type NewsImpact } from '../store/useNewsStore';
import { useAppStore } from '../store/useAppStore';

export function NewsFeed() {
  const news = useNewsStore((state) => state.news);
  const activeCategory = useNewsStore((state) => state.activeCategory);
  const setActiveCategory = useNewsStore((state) => state.setActiveCategory);
  const markAsRead = useNewsStore((state) => state.markAsRead);
  const refreshNews = useNewsStore((state) => state.refreshNews);
  const getFilteredNews = useNewsStore((state) => state.getFilteredNews);
  const setSelectedSymbol = useAppStore((state) => state.setSelectedSymbol);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredNews = getFilteredNews();

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refreshNews();
    }, 60000);

    return () => clearInterval(interval);
  }, [refreshNews]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    refreshNews();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        markAsRead(id);
      }
      return next;
    });
  };

  const handleSymbolClick = (symbol: string) => {
    setSelectedSymbol(symbol);
    // Dispatch custom event to notify chart to update
    window.dispatchEvent(new CustomEvent('changeSymbol', { detail: { symbol } }));
  };

  const getTimeAgo = (timestamp: Date): string => {
    const now = Date.now();
    const diff = now - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const isBreaking = (timestamp: Date): boolean => {
    const diff = Date.now() - timestamp.getTime();
    return diff < 15 * 60 * 1000; // Less than 15 minutes
  };

  const getImpactColor = (impact: NewsImpact): string => {
    switch (impact) {
      case 'high':
        return 'text-red-500';
      case 'medium':
        return 'text-yellow-500';
      case 'low':
        return 'text-gray-500';
    }
  };

  const categories: NewsCategory[] = ['All', 'Forex', 'Crypto', 'Economy', 'Central Banks'];

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300">
      {/* Header */}
      <div className="bg-[#252528] border-b border-zinc-700 p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Icon name="newspaper" size="md" />
            News
          </h3>
          <button
            onClick={handleRefresh}
            className={`p-1.5 hover:bg-zinc-700 rounded transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
            title="Refresh news"
          >
            <Icon name="refresh" size="sm" className="text-zinc-400" />
          </button>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-3 py-1 rounded transition-colors ${
                activeCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* News List */}
      <div className="flex-1 overflow-y-auto">
        {filteredNews.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            No news available
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {filteredNews.map((item) => {
              const isExpanded = expandedItems.has(item.id);
              const breaking = isBreaking(item.timestamp);

              return (
                <div
                  key={item.id}
                  className={`p-3 hover:bg-zinc-800/50 transition-colors cursor-pointer ${
                    !item.isRead ? 'border-l-2 border-l-blue-500 bg-blue-950/10' : ''
                  }`}
                  onClick={() => toggleExpand(item.id)}
                >
                  {/* Header Row */}
                  <div className="flex items-start gap-2 mb-2">
                    {/* Impact Indicator */}
                    <Icon name="connected" size="sm" className={`mt-1.5 ${getImpactColor(item.impact)} fill-current`} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Breaking Badge */}
                      {breaking && (
                        <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold bg-red-600 text-white rounded mr-2 uppercase">
                          Breaking
                        </span>
                      )}

                      {/* Headline */}
                      <h4 className={`text-xs font-semibold text-white mb-1 ${!item.isRead ? 'font-bold' : ''}`}>
                        {item.headline}
                      </h4>

                      {/* Source + Timestamp */}
                      <div className="text-[10px] text-zinc-500 mb-2">
                        {item.source} • {getTimeAgo(item.timestamp)}
                      </div>

                      {/* Symbol Badges */}
                      <div className="flex items-center gap-1 flex-wrap mb-2">
                        {item.symbols.map((symbol) => (
                          <button
                            key={symbol}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSymbolClick(symbol);
                            }}
                            className="px-1.5 py-0.5 text-[9px] font-medium bg-zinc-700 hover:bg-blue-600 text-zinc-300 hover:text-white rounded transition-colors"
                          >
                            {symbol}
                          </button>
                        ))}
                      </div>

                      {/* Expanded Summary */}
                      {isExpanded && (
                        <p className="text-xs text-zinc-400 leading-relaxed animate-in slide-in-from-top-2 duration-200">
                          {item.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="bg-[#252528] border-t border-zinc-700 px-3 py-2 text-[10px] text-zinc-500">
        <div className="flex items-center justify-between">
          <span>{filteredNews.length} items</span>
          <span>{filteredNews.filter((n) => !n.isRead).length} unread</span>
        </div>
      </div>
    </div>
  );
}
