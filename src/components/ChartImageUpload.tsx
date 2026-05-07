import React, { useState, useCallback } from 'react';
import './ChartImageUpload.css';
import { API_ENDPOINTS } from '../config/api';

interface UploadResponse {
    status: string;
    detected_pairs: string[];
    confidence: number;
    analysis_id: string;
    timestamp: string;
    message?: string;
}

interface ChartImageUploadProps {
    onPairsDetected: (pairs: string[]) => void;
}

export const ChartImageUpload: React.FC<ChartImageUploadProps> = ({ onPairsDetected }) => {
    const [dragActive, setDragActive] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [detectedPairs, setDetectedPairs] = useState<string[]>([]);
    const [confidence, setConfidence] = useState<number>(0);
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    }, []);

    const handleFile = async (file: File) => {
        // Validate file type
        if (!file.type.match(/image\/(png|jpeg|jpg)/)) {
            setError('Please upload a PNG or JPEG image');
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            setError('Image size must be less than 10MB');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            setPreviewImage(e.target?.result as string);
        };
        reader.readAsDataURL(file);

        // Upload to backend
        try {
            setUploading(true);
            setError(null);
            setDetectedPairs([]);

            const formData = new FormData();
            formData.append('image', file);

            const response = await fetch(API_ENDPOINTS.chartAnalysis.upload, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to analyze image');
            }

            const result: UploadResponse = await response.json();

            console.log('[ChartUpload] AI detected:', result.detected_pairs);
            console.log('[ChartUpload] Confidence:', result.confidence);

            if (result.detected_pairs.length === 0) {
                setError('No forex symbols detected in this image. Please upload an image showing a market watch or trading chart.');
                return;
            }

            setDetectedPairs(result.detected_pairs);
            setConfidence(result.confidence);
            onPairsDetected(result.detected_pairs);

        } catch (err) {
            console.error('[ChartUpload] Error:', err);
            setError(err instanceof Error ? err.message : 'Failed to analyze image');
        } finally {
            setUploading(false);
        }
    };

    const clearUpload = () => {
        setPreviewImage(null);
        setDetectedPairs([]);
        setConfidence(0);
        setError(null);
    };

    return (
        <div className="chart-image-upload">
            <div className="upload-header">
                <h2>📸 AI Chart Analysis</h2>
                <p>Upload your market watch image to detect symbols</p>
            </div>

            {!previewImage ? (
                <form
                    className={`upload-form ${dragActive ? 'drag-active' : ''}`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onSubmit={(e) => e.preventDefault()}
                >
                    <input
                        type="file"
                        id="image-upload"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={handleChange}
                        style={{ display: 'none' }}
                    />
                    <label htmlFor="image-upload" className="upload-label">
                        <div className="upload-icon">📁</div>
                        <p className="upload-text">
                            {dragActive ? 'Drop image here' : 'Drag & drop or click to upload'}
                        </p>
                        <p className="upload-hint">PNG or JPEG • Max 10MB</p>
                    </label>
                </form>
            ) : (
                <div className="upload-results">
                    <div className="preview-section">
                        <img src={previewImage} alt="Uploaded chart" className="preview-image" />
                        <button className="clear-btn" onClick={clearUpload}>
                            ✕ Clear
                        </button>
                    </div>

                    {uploading && (
                        <div className="analyzing-state">
                            <div className="spinner"></div>
                            <p>🤖 AI is analyzing your image...</p>
                        </div>
                    )}

                    {error && (
                        <div className="error-box">
                            <p>⚠️ {error}</p>
                        </div>
                    )}

                    {detectedPairs.length > 0 && (
                        <div className="detected-pairs">
                            <div className="detected-header">
                                <h3>✅ Detected Symbols ({detectedPairs.length})</h3>
                                <span className="confidence-badge">
                                    {(confidence * 100).toFixed(0)}% confidence
                                </span>
                            </div>
                            <div className="pairs-grid">
                                {detectedPairs.map((pair) => (
                                    <div key={pair} className="pair-card">
                                        <span className="pair-symbol">{pair}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="strict-notice">
                                ℹ️ <strong>Strict Mode:</strong> Showing ONLY symbols visible in your image
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default ChartImageUpload;
