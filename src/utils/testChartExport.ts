/**
 * Test utility for Chart Export functionality
 * Run this in browser console to test chart export
 */

import { ChartExporter } from '../services/chartExporter';

export async function testChartExport() {
  console.group('🧪 Testing Chart Export Functionality');

  try {
    // Test 1: Check if active chart is available
    console.log('Test 1: Checking for active chart...');
    const canvas = (window as any).__activeChartCanvas;
    const container = (window as any).__activeChartContainer;

    if (!canvas && !container) {
      console.error('❌ No active chart found');
      console.log('Please load a chart first');
      return false;
    }

    console.log('✅ Active chart found');
    if (canvas) {
      console.log(`   Canvas: ${canvas.width}x${canvas.height}`);
    }
    if (container) {
      console.log(`   Container: ${container.offsetWidth}x${container.offsetHeight}`);
    }

    // Test 2: Generate preview
    console.log('\nTest 2: Generating preview...');
    if (canvas) {
      const preview = ChartExporter.getPreview(canvas, 300, 200);
      console.log('✅ Preview generated');
      console.log(`   Data URL length: ${preview.length} chars`);
    } else {
      console.log('⚠️ Skipped (no canvas)');
    }

    // Test 3: Export as PNG
    console.log('\nTest 3: Exporting as PNG...');
    const metadata = {
      symbol: 'TEST',
      timeframe: '1m',
      timestamp: new Date()
    };

    const pngBlob = canvas
      ? await ChartExporter.exportCanvas(canvas, metadata, {
          format: 'png',
          scale: 1,
          includeSymbolInfo: true,
          includeTimestamp: true,
          includeWatermark: false
        })
      : await ChartExporter.exportActiveChart(metadata, {
          format: 'png',
          scale: 1
        });

    console.log('✅ PNG export successful');
    console.log(`   Size: ${(pngBlob.size / 1024).toFixed(2)} KB`);
    console.log(`   Type: ${pngBlob.type}`);

    // Test 4: Export as JPG
    console.log('\nTest 4: Exporting as JPG...');
    const jpgBlob = canvas
      ? await ChartExporter.exportCanvas(canvas, metadata, {
          format: 'jpg',
          quality: 0.92,
          scale: 1
        })
      : await ChartExporter.exportActiveChart(metadata, {
          format: 'jpg',
          quality: 0.92
        });

    console.log('✅ JPG export successful');
    console.log(`   Size: ${(jpgBlob.size / 1024).toFixed(2)} KB`);
    console.log(`   Type: ${jpgBlob.type}`);

    // Test 5: Filename generation
    console.log('\nTest 5: Testing filename generation...');
    const pngFilename = ChartExporter.generateFilename(metadata, 'png');
    const jpgFilename = ChartExporter.generateFilename(metadata, 'jpg');

    console.log('✅ Filenames generated');
    console.log(`   PNG: ${pngFilename}`);
    console.log(`   JPG: ${jpgFilename}`);

    // Test 6: Download test (optional, will trigger actual download)
    console.log('\nTest 6: Download test (commented out)');
    console.log('   Uncomment to test actual download:');
    console.log('   ChartExporter.downloadBlob(pngBlob, pngFilename)');

    // Uncomment to test download:
    // ChartExporter.downloadBlob(pngBlob, pngFilename);

    console.log('\n✅ All tests passed!');
    console.groupEnd();

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.groupEnd();
    return false;
  }
}

/**
 * Test different export scales
 */
export async function testExportScales() {
  console.group('🧪 Testing Export Scales');

  const canvas = (window as any).__activeChartCanvas;
  if (!canvas) {
    console.error('❌ No canvas available');
    return;
  }

  const metadata = {
    symbol: 'SCALE_TEST',
    timeframe: '1m',
    timestamp: new Date()
  };

  const scales = [1, 2, 3];

  for (const scale of scales) {
    console.log(`\nTesting ${scale}x scale...`);
    const startTime = performance.now();

    const blob = await ChartExporter.exportCanvas(canvas, metadata, {
      format: 'png',
      scale
    });

    const duration = performance.now() - startTime;

    console.log(`✅ ${scale}x complete`);
    console.log(`   Size: ${(blob.size / 1024).toFixed(2)} KB`);
    console.log(`   Time: ${duration.toFixed(0)} ms`);
  }

  console.groupEnd();
}

/**
 * Test overlay options
 */
export async function testOverlays() {
  console.group('🧪 Testing Overlay Options');

  const canvas = (window as any).__activeChartCanvas;
  if (!canvas) {
    console.error('❌ No canvas available');
    return;
  }

  const metadata = {
    symbol: 'OVERLAY_TEST',
    timeframe: '5m',
    timestamp: new Date()
  };

  const overlayConfigs = [
    { name: 'No overlays', includeSymbolInfo: false, includeTimestamp: false, includeWatermark: false },
    { name: 'Symbol only', includeSymbolInfo: true, includeTimestamp: false, includeWatermark: false },
    { name: 'Timestamp only', includeSymbolInfo: false, includeTimestamp: true, includeWatermark: false },
    { name: 'Watermark only', includeSymbolInfo: false, includeTimestamp: false, includeWatermark: true, watermarkText: 'Test' },
    { name: 'All overlays', includeSymbolInfo: true, includeTimestamp: true, includeWatermark: true, watermarkText: 'Trading Engine' }
  ];

  for (const config of overlayConfigs) {
    console.log(`\nTesting: ${config.name}`);

    const blob = await ChartExporter.exportCanvas(canvas, metadata, {
      format: 'png',
      scale: 1,
      ...config
    });

    console.log(`✅ Export complete`);
    console.log(`   Size: ${(blob.size / 1024).toFixed(2)} KB`);
  }

  console.groupEnd();
}

/**
 * Test quality settings for JPG
 */
export async function testJpgQuality() {
  console.group('🧪 Testing JPG Quality Settings');

  const canvas = (window as any).__activeChartCanvas;
  if (!canvas) {
    console.error('❌ No canvas available');
    return;
  }

  const metadata = {
    symbol: 'QUALITY_TEST',
    timeframe: '1h',
    timestamp: new Date()
  };

  const qualities = [0.1, 0.3, 0.5, 0.7, 0.92, 1.0];

  console.log('\nQuality | Size (KB) | Reduction');
  console.log('--------|-----------|----------');

  let baselineSize = 0;

  for (const quality of qualities) {
    const blob = await ChartExporter.exportCanvas(canvas, metadata, {
      format: 'jpg',
      quality,
      scale: 1
    });

    const sizeKB = blob.size / 1024;

    if (quality === 1.0) {
      baselineSize = sizeKB;
    }

    const reduction = baselineSize > 0 ? ((1 - sizeKB / baselineSize) * 100).toFixed(1) : '0.0';

    console.log(`${(quality * 100).toFixed(0).padStart(7)}% | ${sizeKB.toFixed(2).padStart(9)} | ${reduction}%`);
  }

  console.groupEnd();
}

// Make functions available in window for console testing
if (typeof window !== 'undefined') {
  (window as any).testChartExport = testChartExport;
  (window as any).testExportScales = testExportScales;
  (window as any).testOverlays = testOverlays;
  (window as any).testJpgQuality = testJpgQuality;

  console.log('📊 Chart Export Test Functions Available:');
  console.log('  • testChartExport() - Run all basic tests');
  console.log('  • testExportScales() - Test 1x, 2x, 3x scaling');
  console.log('  • testOverlays() - Test overlay combinations');
  console.log('  • testJpgQuality() - Test JPG quality settings');
}

export default {
  testChartExport,
  testExportScales,
  testOverlays,
  testJpgQuality
};
