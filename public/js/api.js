// API Client para CASTING PRO
const API = {
  baseURL: '',

  async getConfig() {
    const res = await fetch(`${this.baseURL}/api/config`);
    return res.json();
  },

  async getArtistas(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseURL}/api/artistas?${query}`);
    return res.json();
  },

  async getArtista(id, privado = false) {
    const res = await fetch(`${this.baseURL}/api/artistas/${id}?privado=${privado}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao carregar artista');
    }
    return res.json();
  },

  async cadastrar(dados) {
    const res = await fetch(`${this.baseURL}/api/cadastro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro no cadastro');
    return json;
  },

  async confirmarPagamentoInicial(artistId, metodo = 'PIX') {
    const res = await fetch(`${this.baseURL}/api/pagamento/confirmar-inicial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, metodo })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro ao confirmar pagamento');
    return json;
  },

  async uploadFotoPerfil(artistId, fileOrUrl) {
    let res;
    if (fileOrUrl instanceof File) {
      const formData = new FormData();
      formData.append('foto', fileOrUrl);
      res = await fetch(`${this.baseURL}/api/artistas/${artistId}/foto-perfil`, {
        method: 'POST',
        body: formData
      });
    } else {
      res = await fetch(`${this.baseURL}/api/artistas/${artistId}/foto-perfil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_url: fileOrUrl })
      });
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro no upload da foto principal');
    return json;
  },

  async uploadFotoApresentacao(artistId, fileOrUrl, slot = null, legenda = '') {
    let res;
    if (fileOrUrl instanceof File) {
      const formData = new FormData();
      formData.append('foto', fileOrUrl);
      if (slot) formData.append('slot', slot);
      if (legenda) formData.append('legenda', legenda);
      res = await fetch(`${this.baseURL}/api/artistas/${artistId}/fotos-apresentacao`, {
        method: 'POST',
        body: formData
      });
    } else {
      res = await fetch(`${this.baseURL}/api/artistas/${artistId}/fotos-apresentacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_url: fileOrUrl, slot, legenda })
      });
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro no envio da foto');
    return json;
  },

  async excluirFotoApresentacao(artistId, fotoId) {
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}/fotos-apresentacao/${fotoId}`, {
      method: 'DELETE'
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro ao excluir foto');
    return json;
  },

  async reordenarFotosApresentacao(artistId, ordemIds) {
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}/fotos-apresentacao/reordenar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordemIds })
    });
    return res.json();
  },

  async atualizarPerfil(artistId, dados) {
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro ao atualizar dados');
    return json;
  },

  async uploadVideo(artistId, file, slot = 1, titulo = '') {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('slot', slot);
    formData.append('titulo', titulo);
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}/upload-video`, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro no envio do vídeo');
    return json;
  },

  async excluirVideo(artistId, slot) {
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}/videos/${slot}`, {
      method: 'DELETE'
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro ao remover vídeo');
    return json;
  },

  async togglePublicacao(artistId, publicar) {
    const res = await fetch(`${this.baseURL}/api/artistas/${artistId}/publicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicar })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Não foi possível alterar a publicação');
    return json;
  },

  async getAssinatura(artistId) {
    const res = await fetch(`${this.baseURL}/api/assinatura/${artistId}`);
    return res.json();
  },

  async cancelarAssinatura(artistId, motivo = '') {
    const res = await fetch(`${this.baseURL}/api/assinatura/${artistId}/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo })
    });
    return res.json();
  },

  async regularizarMensalidade(artistId, metodo = 'PIX') {
    const res = await fetch(`${this.baseURL}/api/assinatura/${artistId}/regularizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metodo })
    });
    return res.json();
  },

  async loginArtista(email, senha) {
    const res = await fetch(`${this.baseURL}/api/auth/login-artista`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha na autenticação do artista');
    if (json.token && json.artista) {
      localStorage.setItem('casting_auth_token', json.token);
      localStorage.setItem('casting_artist_id', json.artista.id);
      localStorage.setItem('casting_artist_name', json.artista.nome_artistico || json.artista.nome_completo);
    }
    return json;
  },

  async loginAdmin(email, senha) {
    const res = await fetch(`${this.baseURL}/api/auth/login-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Credenciais de administrador inválidas');
    if (json.adminToken) {
      localStorage.setItem('casting_admin_token', json.adminToken);
    }
    return json;
  },

  logoutArtista() {
    localStorage.removeItem('casting_auth_token');
    localStorage.removeItem('casting_artist_id');
    localStorage.removeItem('casting_artist_name');
    window.location.href = '/login.html';
  },

  logoutAdmin() {
    localStorage.removeItem('casting_admin_token');
    window.location.href = '/admin.html';
  },

  async getAdminMetricas() {
    const token = localStorage.getItem('casting_admin_token') || '';
    const res = await fetch(`${this.baseURL}/api/admin/metricas`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (res.status === 401) {
      throw new Error('AUTH_REQUIRED');
    }
    return res.json();
  },

  async simularCiclo(acao, artistId) {
    const token = localStorage.getItem('casting_admin_token') || '';
    const res = await fetch(`${this.baseURL}/api/admin/simular-ciclo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ acao, artistId })
    });
    if (res.status === 401) {
      throw new Error('AUTH_REQUIRED');
    }
    return res.json();
  },

  async updateConfig(config) {
    const res = await fetch(`${this.baseURL}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return res.json();
  }
};
