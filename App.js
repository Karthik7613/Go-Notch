import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, SafeAreaView, StatusBar, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

export default function App() {
  // Default server address - users can change this in app if their local IP differs
  const [serverUrl, setServerUrl] = useState('http://192.168.1.100:3000');
  const [currentUrl, setCurrentUrl] = useState('http://192.168.1.100:3000');
  const [inputUrl, setInputUrl] = useState('http://192.168.1.100:3000');
  const [showConfig, setShowConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const handleConnect = () => {
    let formatted = inputUrl.trim();
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'http://' + formatted;
    }
    setServerUrl(formatted);
    setCurrentUrl(formatted);
    setShowConfig(false);
    setError(null);
    setIsLoading(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Top Header Bar */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>💬 WhatsApp Monitor</Text>
        <TouchableOpacity 
          style={styles.configButton}
          onPress={() => setShowConfig(!showConfig)}
        >
          <Text style={styles.configButtonText}>{showConfig ? '✕ Close' : '⚙️ Server IP'}</Text>
        </TouchableOpacity>
      </View>

      {/* IP Configuration Banner */}
      {showConfig && (
        <View style={styles.configContainer}>
          <Text style={styles.configLabel}>Enter backend server URL (Node.js backend):</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={inputUrl}
              onChangeText={setInputUrl}
              placeholder="http://192.168.x.x:3000"
              placeholderTextColor="#8696a0"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.connectButton} onPress={handleConnect}>
              <Text style={styles.connectButtonText}>Connect</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.configHint}>
            Ensure your mobile phone & computer are connected to the same Wi-Fi network.
          </Text>
        </View>
      )}

      {/* WebView displaying WhatsApp Monitor UI */}
      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: currentUrl }}
          style={styles.webview}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            setError(nativeEvent.description || 'Failed to connect to server');
            setIsLoading(false);
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#00a884" />
              <Text style={styles.loadingText}>Connecting to WhatsApp Monitor...</Text>
            </View>
          )}
        />

        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Connection Failed</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Text style={styles.errorHelp}>
              Make sure `npm start` is running on your computer and both devices share the same Wi-Fi.
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleConnect}>
              <Text style={styles.retryButtonText}>Retry Connection</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.retryButton, { backgroundColor: '#3b82f6', marginTop: 8 }]} 
              onPress={() => setShowConfig(true)}
            >
              <Text style={styles.retryButtonText}>Change Server IP</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    height: 52,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 'bold',
  },
  configButton: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  configButtonText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  configContainer: {
    backgroundColor: '#f8fafc',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  configLabel: {
    color: '#64748b',
    fontSize: 12,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  connectButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
  },
  connectButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  configHint: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 6,
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 13,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(11, 20, 26, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#f87171',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorMessage: {
    color: '#e9edef',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  errorHelp: {
    color: '#8696a0',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#00a884',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
