/**
 * Watchlist Manager
 * Manages custom symbol watchlists with tabs, drag-and-drop, and search
 */

import { Icon } from './ui/Icon';
import React, { useState, useRef, useEffect } from 'react';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { MarketWatch } from './MarketWatch';
import { API_ENDPOINTS } from '../config/api';

interface WatchlistManagerProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
  onOpenOrderEntry?: (symbol: string) => void;
}

export const WatchlistManager: React.FC<WatchlistManagerProps> = ({
  onSelectSymbol,
  selectedSymbol,
  onOpenOrderEntry,
}) => {
  const {
    watchlists,
    activeWatchlistId,
    setActiveWatchlist,
    createWatchlist,
    deleteWatchlist,
    renameWatchlist,
    addSymbolToWatchlist,
    removeSymbolFromWatchlist,
    reorderSymbols,
    getActiveWatchlist,
  } = useWatchlistStore();

  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const activeWatchlist = getActiveWatchlist();

  // Fetch available symbols from API
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  useEffect(() => {
    const fetchSymbols = async () => {
      setIsLoadingSymbols(true);
      try {
        const response = await fetch(API_ENDPOINTS.symbols);
        if (response.ok) {
          const data = await response.json();
          // Handle both array and object response formats
          const symbols = Array.isArray(data) ? data : (data.symbols || []);
          // Extract symbol names if objects, or use directly if strings
          const symbolNames = symbols.map((s: any) =>
            typeof s === 'string' ? s : s.symbol
          ).filter(Boolean);
          setAvailableSymbols(symbolNames);
        } else {
          console.error('Failed to fetch symbols:', response.statusText);
        }
      } catch (error) {
        console.error('Error fetching symbols:', error);
      } finally {
        setIsLoadingSymbols(false);
      }
    };

    fetchSymbols();
  }, []);

  // Filter symbols for search
  const filteredSymbols = availableSymbols.filter((symbol) =>
    symbol.toLowerCase().includes(searchQuery.toLowerCase())
  ).filter((symbol) =>
    !activeWatchlist?.symbols.includes(symbol)
  );

  // Handle create watchlist
  const handleCreateWatchlist = () => {
    if (newWatchlistName.trim()) {
      createWatchlist(newWatchlistName.trim());
      setNewWatchlistName('');
      setIsCreating(false);
    }
  };

  // Handle rename watchlist
  const handleRenameWatchlist = () => {
    if (activeWatchlist && renameValue.trim() && !activeWatchlist.isDefault) {
      renameWatchlist(activeWatchlist.id, renameValue.trim());
      setIsRenaming(false);
      setRenameValue('');
    }
  };

  // Handle delete watchlist
  const handleDeleteWatchlist = (id: string) => {
    if (window.confirm('Are you sure you want to delete this watchlist?')) {
      deleteWatchlist(id);
      setDropdownOpen(false);
    }
  };

  // Handle add symbol from search
  const handleAddSymbol = (symbol: string) => {
    if (activeWatchlist) {
      addSymbolToWatchlist(activeWatchlist.id, symbol);
      setSearchQuery('');
    }
  };

  // Handle remove symbol
  const handleRemoveSymbol = (symbol: string) => {
    if (activeWatchlist) {
      removeSymbolFromWatchlist(activeWatchlist.id, symbol);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, symbol: string, index: number) => {
    setDraggedSymbol(symbol);
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedSymbol && draggedIndex !== null && activeWatchlist && draggedIndex !== dropIndex) {
      const newSymbols = [...activeWatchlist.symbols];
      newSymbols.splice(draggedIndex, 1);
      newSymbols.splice(dropIndex, 0, draggedSymbol);
      reorderSymbols(activeWatchlist.id, newSymbols);
    }

    setDraggedSymbol(null);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedSymbol(null);
    setDraggedIndex(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d11]">
      {/* Tab Bar */}
      <div className="bg-[#1e222d] border-b border-[#363c4e] flex items-center overflow-x-auto custom-scrollbar">
        <div className="flex items-center flex-1 min-w-0">
          {watchlists.map((watchlist) => (
            <button
              key={watchlist.id}
              onClick={() => setActiveWatchlist(watchlist.id)}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeWatchlistId === watchlist.id
                  ? 'border-[#2962ff] text-[#d1d4dc] bg-[#0d0d11]'
                  : 'border-transparent text-gray-500 hover:text-[#d1d4dc] hover:bg-[#2a2e39]'
              }`}
            >
              {watchlist.name}
            </button>
          ))}
        </div>

        {/* Actions Dropdown */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="p-2 text-gray-400 hover:text-[#d1d4dc] hover:bg-[#2a2e39] transition-colors"
            title="Watchlist actions"
          >
            <Icon name="chevron-down" size="md" />
          </button>

          {dropdownOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setDropdownOpen(false)}
              />

              {/* Dropdown Menu */}
              <div className="absolute right-0 top-full mt-1 bg-[#1e222d] border border-[#363c4e] rounded shadow-lg z-20 min-w-[200px]">
                <button
                  onClick={() => {
                    setIsCreating(true);
                    setDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#d1d4dc] hover:bg-[#2a2e39] transition-colors"
                >
                  <Icon name="plus" size="sm" />
                  <span>New Watchlist</span>
                </button>

                {activeWatchlist && !activeWatchlist.isDefault && (
                  <>
                    <button
                      onClick={() => {
                        setRenameValue(activeWatchlist.name);
                        setIsRenaming(true);
                        setDropdownOpen(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#d1d4dc] hover:bg-[#2a2e39] transition-colors"
                    >
                      <Icon name="edit" size="sm" />
                      <span>Rename</span>
                    </button>

                    <button
                      onClick={() => handleDeleteWatchlist(activeWatchlist.id)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#ef5350] hover:bg-[#2a2e39] transition-colors"
                    >
                      <Icon name="trash" size="sm" />
                      <span>Delete</span>
                    </button>
                  </>
                )}

                <div className="h-px bg-[#363c4e] my-1"></div>

                <button
                  onClick={() => {
                    setIsSearchOpen(true);
                    setDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[#d1d4dc] hover:bg-[#2a2e39] transition-colors"
                >
                  <Icon name="search" size="sm" />
                  <span>Add Symbol</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Watchlist Modal */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e222d] border border-[#363c4e] rounded-lg shadow-2xl w-[400px] p-4">
            <h3 className="text-sm font-bold text-[#d1d4dc] mb-4">Create New Watchlist</h3>
            <input
              type="text"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateWatchlist()}
              placeholder="Watchlist name..."
              autoFocus
              className="w-full px-3 py-2 bg-[#0d0d11] border border-[#363c4e] rounded text-[#d1d4dc] text-sm focus:outline-none focus:border-[#2962ff]"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleCreateWatchlist}
                className="flex-1 px-4 py-2 bg-[#2962ff] hover:bg-[#1e53e5] text-white text-sm rounded transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewWatchlistName('');
                }}
                className="flex-1 px-4 py-2 bg-[#363c4e] hover:bg-[#434651] text-[#d1d4dc] text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Watchlist Modal */}
      {isRenaming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e222d] border border-[#363c4e] rounded-lg shadow-2xl w-[400px] p-4">
            <h3 className="text-sm font-bold text-[#d1d4dc] mb-4">Rename Watchlist</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleRenameWatchlist()}
              placeholder="New name..."
              autoFocus
              className="w-full px-3 py-2 bg-[#0d0d11] border border-[#363c4e] rounded text-[#d1d4dc] text-sm focus:outline-none focus:border-[#2962ff]"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleRenameWatchlist}
                className="flex-1 px-4 py-2 bg-[#2962ff] hover:bg-[#1e53e5] text-white text-sm rounded transition-colors"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setIsRenaming(false);
                  setRenameValue('');
                }}
                className="flex-1 px-4 py-2 bg-[#363c4e] hover:bg-[#434651] text-[#d1d4dc] text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Symbol Search Modal */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#1e222d] border border-[#363c4e] rounded-lg shadow-2xl w-[400px] max-h-[600px] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#363c4e]">
              <h3 className="text-sm font-bold text-[#d1d4dc]">Add Symbol</h3>
              <button
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                }}
                className="p-1 text-gray-400 hover:text-[#d1d4dc] transition-colors"
              >
                <Icon name="x-close" size="md" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-[#363c4e]">
              <div className="relative">
                <Icon name="search" size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbols..."
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 bg-[#0d0d11] border border-[#363c4e] rounded text-[#d1d4dc] text-sm focus:outline-none focus:border-[#2962ff]"
                />
              </div>
            </div>

            {/* Symbol List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
              {isLoadingSymbols ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
                  Loading symbols...
                </div>
              ) : filteredSymbols.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
                  {searchQuery ? 'No symbols found' : 'Start typing to search'}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredSymbols.map((symbol) => (
                    <button
                      key={symbol}
                      onClick={() => handleAddSymbol(symbol)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#d1d4dc] hover:bg-[#2a2e39] rounded transition-colors"
                    >
                      <span className="font-medium">{symbol}</span>
                      <Icon name="plus" size="sm" className="text-[#2962ff]" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MarketWatch with active watchlist */}
      {activeWatchlist && (
        <MarketWatch
          watchlist={activeWatchlist.symbols}
          onSelectSymbol={onSelectSymbol}
          selectedSymbol={selectedSymbol}
          onOpenOrderEntry={onOpenOrderEntry}
        />
      )}
    </div>
  );
};
