import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  TextField,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Chip,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Paper
} from '@mui/material';
import {
  CloudSync,
  CheckCircle,
  Error,
  Warning,
  Visibility,
  VisibilityOff,
  Save,
  Storage,
  PlayArrow,
  Refresh,
  Settings,
  TableChart,
  BugReport
} from '@mui/icons-material';
import { createClient } from '@supabase/supabase-js';
import { applySupabaseConfigFromProject } from '../../lib/supabase';

export default function SystemStatus({ surveyConfig, currentProject, onProjectUpdate, onNextStep }) {
  // Step management - restore from localStorage or default to 0
  const getInitialStep = () => {
    if (currentProject) {
      const saved = localStorage.getItem(`supabase_setup_step_${currentProject.id}`);
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  };
  
  const [activeStep, setActiveStep] = useState(getInitialStep());
  
  // Save step to localStorage whenever it changes
  const saveStepToStorage = (step) => {
    if (currentProject) {
      localStorage.setItem(`supabase_setup_step_${currentProject.id}`, step.toString());
      console.log('💾 Saved setup step:', step);
    }
  };
  
  // Wrapper to update step and save to localStorage
  const updateActiveStep = (step) => {
    setActiveStep(step);
    saveStepToStorage(step);
  };
  
  // Simplified state management
  const [config, setConfig] = useState({
    url: '',
    secretKey: '',
    enabled: false
  });
  const [checking, setChecking] = useState(false);
  const [systemStatus, setSystemStatus] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  
  // Database table management
  const [tableStatus, setTableStatus] = useState({
    exists: false,
    checking: false,
    creating: false,
    responseCount: 0,
    error: null
  });
  const [testingResponse, setTestingResponse] = useState(false);

  // Project-specific Supabase client
  const [projectSupabase, setProjectSupabase] = useState(null);
  const [initialCheckDone, setInitialCheckDone] = useState(false);

  const initializeProjectSupabase = (projectConfig) => {
    if (projectConfig && projectConfig.enabled && projectConfig.url && projectConfig.secretKey) {
      try {
        console.log('Initializing project-specific Supabase client');
        const client = createClient(projectConfig.url, projectConfig.secretKey);
        setProjectSupabase(client);
        return client;
      } catch (error) {
        console.error('Failed to initialize project Supabase:', error);
        setProjectSupabase(null);
        return null;
      }
    } else {
      setProjectSupabase(null);
      return null;
    }
  };

  // Load Supabase config from Image Dataset configuration
  useEffect(() => {
    if (currentProject && currentProject.imageDatasetConfig) {
      console.log('Loading Supabase config from Image Dataset:', currentProject.name);
      const { supabaseUrl, supabaseKey } = currentProject.imageDatasetConfig;
      
      if (supabaseUrl && supabaseKey) {
        const supabaseConfig = {
          url: supabaseUrl,
          secretKey: supabaseKey,
          enabled: true
        };
        
        setConfig(supabaseConfig);
        applySupabaseConfigFromProject(currentProject.imageDatasetConfig);
        
        // Restore saved step for this project
        const savedStep = localStorage.getItem(`supabase_setup_step_${currentProject.id}`);
        if (savedStep) {
          const step = parseInt(savedStep, 10);
          console.log('🔄 Restoring setup step:', step);
          setActiveStep(step);
        } else {
          setActiveStep(0);
        }
        
        // Initialize Supabase client
        const client = initializeProjectSupabase(supabaseConfig);
        
        // Only auto-check on initial mount
        if (!initialCheckDone && client) {
          setInitialCheckDone(true);
          checkConnection(client).then(result => {
            if (result.success) {
              setSystemStatus({
                success: true,
                connected: true,
                message: result.message
              });
            }
          });
        }
      } else {
        console.log('No Supabase config found in Image Dataset');
        setConfig({
          url: '',
          secretKey: '',
          enabled: false
        });
        setProjectSupabase(null);
        setActiveStep(0);
      }
    } else {
      console.log('No Image Dataset config found for project');
      setConfig({
        url: '',
        secretKey: '',
        enabled: false
      });
      setProjectSupabase(null);
      setActiveStep(0);
    }
  }, [currentProject?.id, currentProject?.imageDatasetConfig]); // Trigger when Image Dataset config changes

  const validateConfig = () => {
    const errors = [];
    
    if (!config.url) {
      errors.push('Supabase URL is required');
    } else {
      try {
        new URL(config.url);
      } catch {
        errors.push('Invalid Supabase URL format');
      }
    }
    
    if (!config.secretKey) {
      errors.push('Secret Key is required');
    }
    
    return errors;
  };

  const handleTestConnection = async () => {
    const errors = validateConfig();
    if (errors.length > 0) {
      setSystemStatus({
        success: false,
        connected: false,
        error: errors.join(', '),
        message: `Configuration errors: ${errors.join(', ')}`
      });
      return;
    }

    if (!currentProject) {
      setSystemStatus({
        success: false,
        connected: false,
        error: 'No project selected',
        message: 'Please select a project first'
      });
      return;
    }

    setChecking(true);
    
    // Initialize Supabase client with config
    const testConfig = {
      ...config,
      enabled: true
    };
    const client = initializeProjectSupabase(testConfig);
    
    if (!client) {
      setSystemStatus({
        success: false,
        connected: false,
        message: `❌ Failed to initialize Supabase client. Please check your URL and key format.`
      });
      setChecking(false);
      return;
    }
    
    // Test connection with the newly created client
    const connectionResult = await checkConnection(client);
    setSystemStatus({
      success: connectionResult.success,
      connected: connectionResult.connected,
      message: connectionResult.message
    });
    setChecking(false);
    
    // If successful, save configuration
    if (connectionResult.success) {
      setInitialCheckDone(true);
      
      // Save to project - use setTimeout to avoid immediate re-render
      setTimeout(() => {
        const updatedProject = {
          ...currentProject,
          supabaseConfig: testConfig
        };
        onProjectUpdate(updatedProject);
      }, 100);
    }
  };

  const handleContinueToTableSetup = async () => {
    // Move to next step and check table status
    updateActiveStep(1);
    // Small delay to ensure step UI is rendered before checking
    setTimeout(() => {
      refreshDatabaseStatus();
    }, 100);
  };
  
  // Refresh both database connection and table status
  const refreshDatabaseStatus = async () => {
    console.log('🔄 Refreshing database status...');
    setChecking(true);
    
    try {
      // First, refresh connection info
      if (projectSupabase) {
        const connectionResult = await checkConnection(projectSupabase);
        setSystemStatus({
          success: connectionResult.success,
          connected: connectionResult.connected,
          message: connectionResult.message
        });
      }
      
      // Then, check table status
      await checkTableStatus();
    } catch (error) {
      console.error('Error refreshing database status:', error);
    } finally {
      setChecking(false);
    }
  };
  
  // Auto-check table status when entering Step 0 (formerly Step 1)
  useEffect(() => {
    if (activeStep === 0 && projectSupabase && !tableStatus.checking) {
      console.log('🔍 Auto-checking database status for Step 0');
      refreshDatabaseStatus();
    }
  }, [activeStep]);

  const handleSaveAllConfig = async () => {
    // Configuration is already saved in Image Dataset, just mark setup as complete
    
    console.log('🔍 Complete Setup clicked, onNextStep:', !!onNextStep);
    
    // Optionally update a setup completion flag
    const updatedProject = {
      ...currentProject,
      serverSetupComplete: true,
      serverSetupCompletedAt: new Date().toISOString()
    };
    
    onProjectUpdate(updatedProject);
    
    // Navigate to next step immediately (before alert)
    if (onNextStep) {
      console.log('✅ Navigating to next step (Website Setup)');
      onNextStep();
      
      // Show success message after navigation
      setTimeout(() => {
        alert('✅ Server setup complete!\n\nYour Supabase database is configured and ready to collect survey responses.');
      }, 300);
    } else {
      console.error('❌ onNextStep is not defined!');
      alert('✅ Server setup complete!\n\nYour Supabase database is configured and ready to collect survey responses.\n\nPlease manually click on "Step 4 - Website Setup" tab above.');
    }
  };

  const checkConnection = async (client = null) => {
    try {
      // Use provided client or fall back to projectSupabase
      const supabaseClient = client || projectSupabase;
      
      if (!supabaseClient) {
        return {
          success: false,
          connected: false,
          message: `❌ Supabase client not initialized. Please check your credentials.`
        };
      }

      // Test connection using Storage API - this requires valid credentials
      const { data: buckets, error: bucketError } = await supabaseClient
        .storage
        .listBuckets();
      
      if (bucketError) {
        // Check for authentication errors
        if (bucketError.message.includes('JWT') || 
            bucketError.message.includes('Invalid API key') ||
            bucketError.message.includes('authentication') ||
            bucketError.statusCode === 401) {
          return {
            success: false,
            connected: false,
            message: `❌ Connection failed: Invalid API key or credentials`
          };
        }
        
        return {
          success: false,
          connected: false,
          message: `❌ Connection failed: ${bucketError.message}`
        };
      }
      
      // Try to get database tables list using REST API
      let tableCount = 0;
      let tableNames = '';
      
      try {
        // Use the underlying REST API to get schema information
        const url = `${supabaseClient.supabaseUrl}/rest/v1/`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'apikey': supabaseClient.supabaseKey,
            'Authorization': `Bearer ${supabaseClient.supabaseKey}`
          }
        });
        
        if (response.ok) {
          const text = await response.text();
          // PostgREST root returns OpenAPI spec with table info
          // Extract table names from the response
          const tableMatches = text.match(/"\/([a-zA-Z_][a-zA-Z0-9_]*)"/g);
          if (tableMatches) {
            const tables = tableMatches
              .map(m => m.replace(/["\\/]/g, ''))
              .filter(name => !name.startsWith('rpc/') && name.length > 0);
            tableCount = tables.length;
            tableNames = tables.slice(0, 5).join(', ');
            if (tables.length > 5) tableNames += '...';
          }
        }
      } catch (tableError) {
        console.log('Could not fetch table list:', tableError);
      }
      
      // Connection successful! Show bucket and table info
      const bucketCount = buckets ? buckets.length : 0;
      const bucketList = buckets && buckets.length > 0 
        ? buckets.map(b => b.name).join(', ') 
        : 'none';
      
      let message = `✅ Database connected!\n`;
      message += `📦 Storage: ${bucketCount} bucket(s)${bucketCount > 0 ? ' (' + bucketList + ')' : ''}\n`;
      message += `📊 Database: ${tableCount} table(s)${tableNames ? ' (' + tableNames + ')' : ''}`;
      
      return {
        success: true,
        connected: true,
        bucketCount: bucketCount,
        tableCount: tableCount,
        message: message
      };
    } catch (error) {
      return {
        success: false,
        connected: false,
        message: `❌ Connection failed: ${error.message || 'Unknown error'}`
      };
    }
  };

  const checkTableStatus = async () => {
    console.log('🔍 Checking survey_responses table status...');
    setTableStatus(prev => ({ ...prev, checking: true, error: null }));
    
    try {
      if (!projectSupabase) {
        console.error('❌ Supabase client not initialized');
        setTableStatus({
          exists: false,
          checking: false,
          creating: false,
          responseCount: 0,
          error: 'Supabase client not initialized'
        });
        return;
      }

      // Check if table exists by trying to query it
      const result = await projectSupabase
        .from('survey_responses')
        .select('*', { count: 'exact', head: true });

      console.log('📊 Full result:', {
        data: result.data,
        error: result.error,
        count: result.count,
        status: result.status,
        statusText: result.statusText
      });

      const { data, error, count, status } = result;

      // Check for various indicators that table doesn't exist:
      // 1. Explicit error
      // 2. 404 status
      // 3. 204 status with null count (table not found, not just empty)
      // 4. null data AND null count (different from empty table which would have count: 0)
      
      const tableNotFound = 
        status === 404 || 
        (status === 204 && count === null && data === null) ||
        error?.code === 'PGRST116' || 
        error?.code === '42P01' ||
        error?.message?.includes('does not exist') ||
        error?.message?.includes('relation') ||
        error?.message?.includes('not found');

      if (tableNotFound) {
        console.log('✅ Confirmed: Table does not exist', {
          reason: status === 404 ? '404 status' :
                  (status === 204 && count === null) ? '204 with null count' :
                  error?.code || error?.message || 'other'
        });
        setTableStatus({
          exists: false,
          checking: false,
          creating: false,
          responseCount: 0,
          error: null
        });
      } else if (error) {
        console.error('❌ Unexpected error checking table:', error);
        // For other errors, assume table doesn't exist
        setTableStatus({
          exists: false,
          checking: false,
          creating: false,
          responseCount: 0,
          error: error?.message || 'Unknown error'
        });
      } else {
        // Table exists - count will be 0 or a positive number (not null)
        console.log(`✅ Table exists with ${count || 0} responses`);
        setTableStatus({
          exists: true,
          checking: false,
          creating: false,
          responseCount: count || 0,
          error: null
        });
      }
    } catch (error) {
      console.error('❌ Error checking table status:', error);
      // On any error, assume table doesn't exist
      setTableStatus({
        exists: false,
        checking: false,
        creating: false,
        responseCount: 0,
        error: error.message
      });
    }
  };

  const createSurveyResponsesTable = async () => {
    setTableStatus(prev => ({ ...prev, creating: true, error: null }));

    try {
      if (!projectSupabase) {
        const errorMsg = 'Supabase client not initialized';
        setTableStatus(prev => ({
          ...prev,
          creating: false,
          error: errorMsg
        }));
        alert(`❌ ${errorMsg}\n\nPlease check your Supabase configuration.`);
        return;
      }

      // Try multiple methods to create the table
      
      // Method 1: Try using RPC (if it exists)
      try {
        const { error: rpcError } = await projectSupabase.rpc('exec_sql', {
          sql: getSQLCreationScript()
        });
        
        if (!rpcError) {
          // Success!
          setTableStatus(prev => ({
            ...prev,
            exists: true,
            creating: false
          }));
          alert('✅ Table created successfully!');
          await checkTableStatus();
          updateActiveStep(2);
          return;
        }
      } catch (rpcErr) {
        console.log('RPC method failed, trying direct SQL...', rpcErr);
      }

      // Method 2: Try using REST API directly
      try {
        const response = await fetch(`${projectSupabase.supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'apikey': projectSupabase.supabaseKey,
            'Authorization': `Bearer ${projectSupabase.supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sql: getSQLCreationScript() })
        });
        
        if (response.ok) {
          setTableStatus(prev => ({
            ...prev,
            exists: true,
            creating: false
          }));
          alert('✅ Table created successfully!');
          await checkTableStatus();
          updateActiveStep(2);
          return;
        }
      } catch (restErr) {
        console.log('REST API method failed:', restErr);
      }

      // Both methods failed - show manual instructions
      const errorMsg = 'Unable to create table automatically. This usually happens when RLS (Row Level Security) policies are restrictive.';
      setTableStatus(prev => ({
        ...prev,
        creating: false,
        error: errorMsg
      }));
      
      alert(`⚠️ ${errorMsg}\n\nPlease create it manually in Supabase SQL Editor:\n\n${getSQLCreationScript()}`);
      
    } catch (error) {
      console.error('Error creating table:', error);
      const errorMsg = error?.message || 'Unknown error occurred';
      setTableStatus(prev => ({
        ...prev,
        creating: false,
        error: errorMsg
      }));
      
      alert(`❌ Unable to create table automatically.\n\nError: ${errorMsg}\n\nPlease create it manually in Supabase SQL Editor:\n\n${getSQLCreationScript()}`);
    }
  };

  const getSQLCreationScript = () => {
    return `CREATE TABLE IF NOT EXISTS survey_responses (
  id BIGSERIAL PRIMARY KEY,
  participant_id TEXT NOT NULL,
  project_id TEXT,
  responses JSONB NOT NULL,
  displayed_images JSONB,
  survey_metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_created_at ON survey_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_responses_participant_id ON survey_responses(participant_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_project_id ON survey_responses(project_id);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous inserts to survey_responses" ON survey_responses;
CREATE POLICY "Allow anonymous inserts to survey_responses"
ON survey_responses
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

GRANT INSERT ON TABLE survey_responses TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE survey_responses_id_seq TO anon, authenticated;

DROP POLICY IF EXISTS "Allow public read survey_responses" ON survey_responses;
REVOKE SELECT ON TABLE survey_responses FROM anon, authenticated;`;
  };

  const testSurveyResponse = async () => {
    setTestingResponse(true);

    try {
      if (!projectSupabase) {
        throw new Error('Supabase client not initialized');
      }

      // Create a test response
      const testData = {
        participant_id: `test_${Date.now()}`,
        project_id: currentProject?.id || 'test',
        responses: {
          test_question: 'test_answer',
          timestamp: new Date().toISOString()
        },
        displayed_images: {},
        survey_metadata: {
          test: true,
          project_id: currentProject?.id || 'test',
          project_name: currentProject?.name || 'Test Project'
        }
      };

      const { data, error } = await projectSupabase
        .from('survey_responses')
        .insert([testData])
        .select();

      if (error) throw error;

      alert('✅ Test response saved successfully!\n\nCheck your Supabase dashboard → Table Editor → survey_responses to see the test data.');
      
      // Refresh table status to update count
      await checkTableStatus();
    } catch (error) {
      console.error('Error testing response:', error);
      alert(`❌ Failed to save test response: ${error.message}`);
    } finally {
      setTestingResponse(false);
    }
  };

  const steps = [
    {
      label: 'Create Database Table',
      description: 'Set up survey_responses table',
      icon: <TableChart />
    },
    {
      label: 'Test Live Survey',
      description: 'Test survey and verify responses',
      icon: <PlayArrow />
    }
  ];

  const handleNext = () => {
    const newStep = activeStep + 1;
    updateActiveStep(newStep);
  };

  const handleBack = () => {
    const newStep = activeStep - 1;
    updateActiveStep(newStep);
  };

  const handleReset = () => {
    updateActiveStep(0);
  };

  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <Box>
            {/* Database Connection Status Card */}
            <Card variant="outlined" sx={{ mb: 3, bgcolor: 'primary.50' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="h6" color="primary">
                    📊 Database Status
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={checking ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
                    onClick={refreshDatabaseStatus}
                    disabled={checking}
                    size="medium"
                  >
                    {checking ? 'Refreshing...' : 'Refresh Status'}
                  </Button>
                </Box>
                
                {systemStatus && systemStatus.connected ? (
                  <Box sx={{ whiteSpace: 'pre-line' }}>
                    <Typography variant="body2" color="text.secondary">
                      {systemStatus.message}
                    </Typography>
                  </Box>
                ) : (
                  <Alert severity="warning">
                    ⚠️ Database connection status unknown. Click "Refresh Status" to check.
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* survey_responses Table Status */}
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Storage color={tableStatus.exists ? 'success' : 'action'} />
                    <Typography variant="subtitle1">
                      survey_responses Table
                    </Typography>
                    {tableStatus.exists && (
                      <Chip 
                        label={`${tableStatus.responseCount} responses`} 
                        size="small" 
                        color="primary"
                      />
                    )}
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={tableStatus.checking ? <CircularProgress size={14} color="inherit" /> : <Refresh />}
                    onClick={checkTableStatus}
                    disabled={tableStatus.checking}
                  >
                    {tableStatus.checking ? 'Refreshing...' : 'Refresh Status'}
                  </Button>
                </Box>

                {tableStatus.checking ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
                    <CircularProgress size={20} />
                    <Typography variant="body2" color="text.secondary">
                      Checking database tables...
                    </Typography>
                  </Box>
                ) : tableStatus.exists === true ? (
                  <Box>
                    <Alert severity="success" sx={{ mb: 2 }}>
                      ✅ Table is ready! Survey responses will be automatically saved.
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                      Current responses: <strong>{tableStatus.responseCount}</strong>
                    </Typography>
                  </Box>
                ) : tableStatus.exists === false ? (
                  <Box>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      ⚠️ The <strong>survey_responses</strong> table doesn't exist in your database.
                    </Alert>
                    
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      This table is required to store survey responses. You can create it automatically or manually:
                    </Typography>
                    
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      <strong>Option 1:</strong> Click "Create Table" (automatic, recommended)<br/>
                      <strong>Option 2:</strong> Copy SQL and run manually in Supabase SQL Editor
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                      <Button
                        variant="contained"
                        onClick={createSurveyResponsesTable}
                        disabled={tableStatus.creating}
                        startIcon={tableStatus.creating ? <CircularProgress size={16} /> : <Storage />}
                      >
                        {tableStatus.creating ? 'Creating...' : 'Create Table Automatically'}
                      </Button>

                      <Button
                        variant="outlined"
                        onClick={() => {
                          const sql = getSQLCreationScript();
                          navigator.clipboard.writeText(sql);
                          alert('✅ SQL script copied to clipboard!\n\n📝 Steps to create manually:\n1. Go to Supabase Dashboard\n2. Click "SQL Editor" in the left menu\n3. Paste the SQL and click "Run"');
                        }}
                      >
                        Copy SQL Script
                      </Button>
                    </Box>

                    {/* Show SQL script for manual creation */}
                    <Box sx={{ 
                      p: 2, 
                      backgroundColor: '#f5f5f5', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      overflow: 'auto',
                      maxHeight: '200px',
                      mb: 2
                    }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {getSQLCreationScript()}
                      </pre>
                    </Box>

                    {tableStatus.error && (
                      <Alert severity="error" sx={{ mb: 2 }}>
                        <strong>Error:</strong> {tableStatus.error}
                        <br/><br/>
                        <Typography variant="body2">
                          💡 <strong>Solution:</strong> Please copy the SQL script above and run it manually in Supabase SQL Editor.
                        </Typography>
                      </Alert>
                    )}
                  </Box>
                ) : (
                  <Box>
                    <Alert severity="info">
                      ℹ️ Table status unknown. Click "Refresh" to check.
                    </Alert>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Debug: exists={JSON.stringify(tableStatus.exists)}, checking={JSON.stringify(tableStatus.checking)}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Alert severity="success" sx={{ mb: 3 }}>
              ✅ Database and table are ready!
            </Alert>

            {/* View Live Survey */}
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 2 }}>
                  🎯 Test Live Survey
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Open your live survey in a new tab, complete it, and verify that responses are saved to the database.
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                  <Button
                    variant="contained"
                    onClick={() => {
                      // Open survey with current project ID
                      const projectId = currentProject?.id || 'default';
                      const surveyUrl = `/survey?project=${projectId}`;
                      console.log('Opening survey for project:', projectId, '→', surveyUrl);
                      window.open(surveyUrl, '_blank');
                    }}
                    startIcon={<Visibility />}
                    size="large"
                  >
                    View Live Survey
                  </Button>

                  <Button
                    variant="outlined"
                    onClick={() => {
                      refreshDatabaseStatus();
                    }}
                    disabled={checking}
                    startIcon={checking ? <CircularProgress size={16} /> : <Refresh />}
                  >
                    {checking ? 'Refreshing...' : 'Check Response Count'}
                  </Button>
                </Box>

                {tableStatus.responseCount > 0 ? (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <strong>✅ Success!</strong> Database has <strong>{tableStatus.responseCount}</strong> response(s).
                    <br/>
                    <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                      💡 You can view responses in Supabase Dashboard → Table Editor → survey_responses
                    </Typography>
                  </Alert>
                ) : (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    <strong>📝 Instructions:</strong>
                    <br/>
                    1. Click "View Live Survey" to open the survey
                    <br/>
                    2. Complete and submit the survey
                    <br/>
                    3. Return here and click "Check Response Count"
                    <br/>
                    4. Verify that the response count increases
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Quick Test (Optional) */}
            <Card variant="outlined" sx={{ mb: 3, borderStyle: 'dashed' }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                  🧪 Quick Test (Optional)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  If you prefer, you can run a quick automated test to verify database connectivity.
                </Typography>

                <Button
                  variant="outlined"
                  onClick={testSurveyResponse}
                  disabled={testingResponse}
                  startIcon={testingResponse ? <CircularProgress size={16} /> : <PlayArrow />}
                  size="small"
                >
                  {testingResponse ? 'Testing...' : 'Run Quick Test'}
                </Button>
              </CardContent>
            </Card>

            <Alert severity="info">
              <Typography variant="body2">
                After successful testing, click <strong>"Complete Setup"</strong> below to finish.
              </Typography>
            </Alert>
          </Box>
        );

      default:
        return 'Unknown step';
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, color: 'primary.main' }}>
        🗄️ Server Setup
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Set up your Supabase database table to store survey responses.
      </Typography>

      {/* Supabase Configuration Status */}
      {!config.url || !config.secretKey ? (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            ⚠️ Supabase Not Configured
          </Typography>
          <Typography variant="body2">
            Please configure Supabase in <strong>Step 1 — Image Dataset</strong> (Supabase Storage Configuration section) first. 
            The Supabase configuration is now centralized there for both image storage and response collection.
          </Typography>
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            ✅ Supabase Configured
          </Typography>
          <Typography variant="body2">
            <strong>Project URL:</strong> {config.url}<br/>
            Connected and ready to set up database table.
          </Typography>
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Stepper activeStep={activeStep} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={step.label}>
              <StepLabel
                optional={
                  index === steps.length - 1 ? (
                    <Typography variant="caption">Last step</Typography>
                  ) : null
                }
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {step.icon}
                  <Box>
                    <Typography variant="subtitle2">{step.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {step.description}
                    </Typography>
                  </Box>
                </Box>
              </StepLabel>
              <StepContent>
                {getStepContent(index)}
                <Box sx={{ mb: 2, mt: 3 }}>
                  <div>
                    {index === 0 && tableStatus.exists && (
                      <Button
                        variant="contained"
                        onClick={handleNext}
                        sx={{ mt: 1, mr: 1 }}
                      >
                        Continue
                      </Button>
                    )}
                    
                    {index === 1 && (
                      <Button
                        variant="contained"
                        onClick={handleSaveAllConfig}
                        startIcon={<Save />}
                        sx={{ mt: 1, mr: 1 }}
                        color="success"
                      >
                        Complete Setup
                      </Button>
                    )}
                    
                    <Button
                      disabled={index === 0}
                      onClick={handleBack}
                      sx={{ mt: 1, mr: 1 }}
                    >
                      Back
                    </Button>
                  </div>
                </Box>
              </StepContent>
            </Step>
          ))}
        </Stepper>
        
        {activeStep === steps.length && (
          <Paper square elevation={0} sx={{ p: 3, bgcolor: 'success.light', color: 'success.contrastText' }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              🎉 Server Setup Complete!
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Your Supabase database is configured and ready to collect survey responses.
            </Typography>
            <Button onClick={handleReset} sx={{ mt: 1, mr: 1 }}>
              Reset Setup
            </Button>
          </Paper>
        )}
      </Paper>
    </Box>
  );
}
