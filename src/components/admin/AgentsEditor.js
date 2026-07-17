import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Typography,
  Alert,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Paper,
  Stack
} from '@mui/material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  Add,
  Edit,
  Delete,
  ExpandMore,
  RestartAlt,
  Save
} from '@mui/icons-material';

// Default agents configuration
const DEFAULT_AGENTS = {
  'urban-scientist': {
    name: 'Urban Scientist',
    emoji: '🔬',
    expertise: 'Urban studies methodology, research design, spatial analysis',
    focus: [
      'Research question clarity and feasibility',
      'Sampling strategy and data collection methods',
      'Scientific rigor and validity',
      'Integration with urban theory'
    ]
  },
  'urban-designer': {
    name: 'Urban Designer',
    emoji: '🏙️',
    expertise: 'Urban design principles, streetscape quality, placemaking',
    focus: [
      'Streetscape design elements coverage',
      'Visual quality assessment criteria',
      'Design intervention evaluation',
      'Public space design considerations'
    ]
  },
  'perception-psychologist': {
    name: 'Perception Psychologist',
    emoji: '🧠',
    expertise: 'Human perception, cognitive psychology, survey methodology',
    focus: [
      'Question wording and cognitive load',
      'Response bias and anchoring effects',
      'Scale appropriateness and rating methods',
      'Participant understanding and clarity'
    ]
  },
  'test-participant': {
    name: 'Test Participant',
    emoji: '👤',
    expertise: 'User experience, survey usability, participant perspective',
    focus: [
      'Survey length and engagement',
      'Question clarity from user perspective',
      'Interface usability and flow',
      'Motivation and completion likelihood'
    ]
  },
  'data-analyst': {
    name: 'Data Analyst',
    emoji: '📊',
    expertise: 'Statistical analysis, data quality, measurement validity',
    focus: [
      'Data quality and completeness',
      'Statistical analysis readiness',
      'Variable measurement and operationalization',
      'Data export and analysis workflow'
    ]
  }
};

export default function AgentsEditor({ onAgentsChange, currentProject }) {
  const [agents, setAgents] = useState({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(null);
  const [currentAgentId, setCurrentAgentId] = useState('');
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Load agents from localStorage or use defaults (per project)
  useEffect(() => {
    if (!currentProject?.id) {
      setAgents(DEFAULT_AGENTS);
      return;
    }
    const savedAgents = localStorage.getItem(`customAgents_${currentProject.id}`);
    if (savedAgents) {
      try {
        setAgents(JSON.parse(savedAgents));
        console.log('✅ Loaded agents for project:', currentProject.id);
      } catch (e) {
        console.error('Failed to load agents:', e);
        setAgents(DEFAULT_AGENTS);
      }
    } else {
      setAgents(DEFAULT_AGENTS);
    }
  }, [currentProject?.id]);

  // Save agents to localStorage (per project)
  const saveAgents = (newAgents) => {
    setAgents(newAgents);
    if (currentProject?.id) {
      localStorage.setItem(`customAgents_${currentProject.id}`, JSON.stringify(newAgents));
      console.log('💾 Agents saved for project:', currentProject.id);
    }
    if (onAgentsChange) {
      onAgentsChange(newAgents);
    }
    setSaveMessage('Agents configuration saved for this project!');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // Open edit dialog
  const handleEdit = (agentId) => {
    setCurrentAgentId(agentId);
    setCurrentAgent({ ...agents[agentId] });
    setIsNewAgent(false);
    setEditDialogOpen(true);
  };

  // Open new agent dialog
  const handleAdd = () => {
    setCurrentAgentId('');
    setCurrentAgent({
      name: '',
      emoji: '🤖',
      expertise: '',
      focus: ['']
    });
    setIsNewAgent(true);
    setEditDialogOpen(true);
  };

  // Delete agent
  const handleDelete = (agentId) => {
    setConfirmDialog({
      title: 'Delete agent',
      message: `Are you sure you want to delete ${agents[agentId].name}?`,
      confirmLabel: 'Delete',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        const newAgents = { ...agents };
        delete newAgents[agentId];
        saveAgents(newAgents);
      },
    });
  };

  // Reset to defaults
  const handleReset = () => {
    setConfirmDialog({
      title: 'Reset agents',
      message: 'Reset all agents to default configuration? This cannot be undone.',
      confirmLabel: 'Reset',
      confirmColor: 'error',
      onConfirm: () => {
        setConfirmDialog(null);
        saveAgents(DEFAULT_AGENTS);
      },
    });
  };

  // Save edited agent
  const handleSaveAgent = () => {
    if (!currentAgent.name || !currentAgent.expertise) {
      alert('Please fill in name and expertise');
      return;
    }

    // Generate ID from name if new
    let agentId = currentAgentId;
    if (isNewAgent) {
      agentId = currentAgent.name.toLowerCase().replace(/\s+/g, '-');
      // Check if ID already exists
      if (agents[agentId]) {
        alert('An agent with this name already exists');
        return;
      }
    }

    const newAgents = {
      ...agents,
      [agentId]: { ...currentAgent }
    };
    
    saveAgents(newAgents);
    setEditDialogOpen(false);
  };

  // Update focus item
  const updateFocusItem = (index, value) => {
    const newFocus = [...currentAgent.focus];
    newFocus[index] = value;
    setCurrentAgent({ ...currentAgent, focus: newFocus });
  };

  // Add focus item
  const addFocusItem = () => {
    setCurrentAgent({
      ...currentAgent,
      focus: [...currentAgent.focus, '']
    });
  };

  // Remove focus item
  const removeFocusItem = (index) => {
    const newFocus = currentAgent.focus.filter((_, i) => i !== index);
    setCurrentAgent({ ...currentAgent, focus: newFocus });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2">Multi-Agent Review Agents</Typography>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            startIcon={<Add />}
            onClick={handleAdd}
            variant="outlined"
          >
            Add Agent
          </Button>
          <Button
            size="small"
            startIcon={<RestartAlt />}
            onClick={handleReset}
            variant="outlined"
            color="warning"
          >
            Reset to Default
          </Button>
        </Stack>
      </Box>

      {saveMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {saveMessage}
        </Alert>
      )}

      <List dense>
        {Object.entries(agents).map(([agentId, agent]) => (
          <Paper key={agentId} sx={{ mb: 1, p: 1 }}>
            <ListItem>
              <ListItemText
                primary={
                  <Typography variant="body2">
                    {agent.emoji} <strong>{agent.name}</strong>
                  </Typography>
                }
                secondary={
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {agent.expertise}
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      {agent.focus.map((f, i) => (
                        <Chip
                          key={i}
                          label={f}
                          size="small"
                          sx={{ mr: 0.5, mb: 0.5, fontSize: '0.7rem' }}
                        />
                      ))}
                    </Box>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleEdit(agentId)}
                  sx={{ mr: 1 }}
                >
                  <Edit fontSize="small" />
                </IconButton>
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleDelete(agentId)}
                  color="error"
                >
                  <Delete fontSize="small" />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          </Paper>
        ))}
      </List>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        💡 Agents are stored in browser localStorage and will be used in multi-agent reviews
      </Typography>

      {/* Edit/Add Agent Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {isNewAgent ? 'Add New Agent' : 'Edit Agent'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Agent Name"
              value={currentAgent?.name || ''}
              onChange={(e) => setCurrentAgent({ ...currentAgent, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            
            <TextField
              fullWidth
              label="Emoji"
              value={currentAgent?.emoji || ''}
              onChange={(e) => setCurrentAgent({ ...currentAgent, emoji: e.target.value })}
              helperText="Choose an emoji to represent this agent"
              sx={{ mb: 2 }}
            />
            
            <TextField
              fullWidth
              label="Expertise"
              value={currentAgent?.expertise || ''}
              onChange={(e) => setCurrentAgent({ ...currentAgent, expertise: e.target.value })}
              helperText="Brief description of the agent's expertise"
              multiline
              rows={2}
              sx={{ mb: 2 }}
            />
            
            <Divider sx={{ my: 2 }} />
            
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2">Focus Areas</Typography>
              <Button
                size="small"
                startIcon={<Add />}
                onClick={addFocusItem}
              >
                Add Focus
              </Button>
            </Box>
            
            {currentAgent?.focus.map((focus, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  fullWidth
                  size="small"
                  value={focus}
                  onChange={(e) => updateFocusItem(index, e.target.value)}
                  placeholder={`Focus area ${index + 1}`}
                />
                <IconButton
                  size="small"
                  onClick={() => removeFocusItem(index)}
                  color="error"
                  disabled={currentAgent.focus.length === 1}
                >
                  <Delete />
                </IconButton>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSaveAgent}
            variant="contained"
            startIcon={<Save />}
          >
            Save Agent
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
  );
}
