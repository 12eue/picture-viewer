const api = window.pictureViewer;

const SIDEBAR_STORAGE_KEY = 'picture-viewer:sidebar-collapsed';
const SIDEBAR_WIDTH_STORAGE_KEY = 'picture-viewer:sidebar-width';
const WHEEL_GESTURE_IDLE_MS = 120;
const WHEEL_NAVIGATION_THRESHOLD = 10;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 560;
const MIN_VIEWER_WIDTH = 420;
const SIDEBAR_LAYOUT_GAP = 44;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;

const FIT_MODES = {
  screen: {
    label: '适应屏幕',
    next: 'width',
  },
  width: {
    label: '适应宽度',
    next: 'actual',
  },
  actual: {
    label: '实际大小',
    next: 'screen',
  },
};

const elements = {
  app: document.querySelector('#app'),
  sidebar: document.querySelector('#sidebar'),
  sidebarResizer: document.querySelector('#sidebarResizer'),
  collapseSidebarButton: document.querySelector('#collapseSidebarButton'),
  revealSidebarButton: document.querySelector('#revealSidebarButton'),
  directoryTab: document.querySelector('#directoryTab'),
  imagesTab: document.querySelector('#imagesTab'),
  directoryPanel: document.querySelector('#directoryPanel'),
  imagesPanel: document.querySelector('#imagesPanel'),
  directoryTree: document.querySelector('#directoryTree'),
  currentDirectoryName: document.querySelector('#currentDirectoryName'),
  refreshDirectoryButton: document.querySelector('#refreshDirectoryButton'),
  imageList: document.querySelector('#imageList'),
  imageListCount: document.querySelector('#imageListCount'),
  refreshImagesButton: document.querySelector('#refreshImagesButton'),
  stageViewport: document.querySelector('#stageViewport'),
  stageContent: document.querySelector('#stageContent'),
  zoomLayer: document.querySelector('#zoomLayer'),
  mainImage: document.querySelector('#mainImage'),
  emptyState: document.querySelector('#emptyState'),
  emptyStateTitle: document.querySelector('#emptyState h1'),
  emptyStateDescription: document.querySelector('#emptyState p'),
  emptyStateActions: document.querySelector('#emptyState .empty-actions'),
  openFileButton: document.querySelector('#openFileButton'),
  openDirectoryButton: document.querySelector('#openDirectoryButton'),
  previousZone: document.querySelector('#previousZone'),
  nextZone: document.querySelector('#nextZone'),
  imageName: document.querySelector('#imageName'),
  imagePosition: document.querySelector('#imagePosition'),
  fitModeButton: document.querySelector('#fitModeButton'),
  toast: document.querySelector('#toast'),
};

const state = {
  rootDirectory: null,
  currentDirectory: null,
  images: [],
  currentIndex: -1,
  viewMode: 'directory',
  sidebarCollapsed: readSidebarPreference(),
  sidebarWidth: readSidebarWidth(),
  sidebarResize: null,
  fitMode: 'screen',
  zoom: 1,
  naturalWidth: 0,
  naturalHeight: 0,
  baseWidth: 0,
  baseHeight: 0,
  directoryCache: new Map(),
  directoryRequests: new Map(),
  expandedDirectories: new Set(),
  listItems: [],
  imageObserver: null,
  imageLoadSequence: 0,
  loadingImageUrl: null,
  directoryLoadSequence: 0,
  stageWheelGestureLocked: false,
  stageWheelAccumulatedDelta: 0,
  stageWheelGestureTimer: null,
  gestureStartZoom: 1,
  lastStageWidth: 0,
  lastStageHeight: 0,
  toastTimer: null,
};

function readSidebarPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistSidebarPreference(collapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // A missing preference should not prevent the viewer from working.
  }
}

function readSidebarWidth() {
  try {
    const width = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

function persistSidebarWidth(width) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // A missing preference should not prevent the viewer from working.
  }
}

function getDefaultSidebarWidth() {
  return clampSidebarWidth(Math.min(320, window.innerWidth * 0.26));
}

function getMaximumSidebarWidth() {
  const availableWidth = window.innerWidth - MIN_VIEWER_WIDTH - SIDEBAR_LAYOUT_GAP;
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, availableWidth),
  );
}

function clampSidebarWidth(width) {
  return Math.round(Math.min(getMaximumSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)));
}

function applySidebarWidth(width) {
  const clampedWidth = clampSidebarWidth(width);
  state.sidebarWidth = clampedWidth;
  elements.app.style.setProperty('--sidebar-width', `${clampedWidth}px`);
  elements.sidebarResizer.setAttribute('aria-valuemin', String(MIN_SIDEBAR_WIDTH));
  elements.sidebarResizer.setAttribute('aria-valuemax', String(getMaximumSidebarWidth()));
  elements.sidebarResizer.setAttribute('aria-valuenow', String(clampedWidth));
  return clampedWidth;
}

function handleSidebarResizeStart(event) {
  if (state.sidebarCollapsed || event.button !== 0) {
    return;
  }

  state.sidebarResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: elements.sidebar.getBoundingClientRect().width,
  };

  document.body.classList.add('is-resizing-sidebar');
  elements.sidebarResizer.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handleSidebarResizeMove(event) {
  if (!state.sidebarResize || state.sidebarResize.pointerId !== event.pointerId) {
    return;
  }

  const nextWidth =
    state.sidebarResize.startWidth + event.clientX - state.sidebarResize.startX;
  applySidebarWidth(nextWidth);
}

function handleSidebarResizeEnd(event) {
  if (!state.sidebarResize || state.sidebarResize.pointerId !== event.pointerId) {
    return;
  }

  persistSidebarWidth(state.sidebarWidth);
  state.sidebarResize = null;
  document.body.classList.remove('is-resizing-sidebar');

  if (elements.sidebarResizer.hasPointerCapture(event.pointerId)) {
    elements.sidebarResizer.releasePointerCapture(event.pointerId);
  }
}

function handleSidebarResizerKeyDown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) {
    return;
  }

  event.preventDefault();

  if (event.key === 'Home') {
    applySidebarWidth(getDefaultSidebarWidth());
  } else {
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const step = event.shiftKey ? 40 : 16;
    applySidebarWidth(state.sidebarWidth + direction * step);
  }

  persistSidebarWidth(state.sidebarWidth);
}

function pathKey(targetPath) {
  if (!targetPath) {
    return '';
  }

  return api.platform === 'darwin' || api.platform === 'win32'
    ? targetPath.toLocaleLowerCase()
    : targetPath;
}

function pathsEqual(left, right) {
  return Boolean(left && right) && pathKey(left) === pathKey(right);
}

function basename(targetPath) {
  if (!targetPath) {
    return '';
  }

  const withoutTrailingSeparators = targetPath.replace(/[\\/]+$/, '');
  const parts = withoutTrailingSeparators.split(/[\\/]/);
  return parts.at(-1) || withoutTrailingSeparators || targetPath;
}

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || '发生未知错误');
}

function showToast(message, { error = false, duration = 3600 } = {}) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', error);
  elements.toast.classList.add('is-visible');

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, duration);
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  elements.app.classList.toggle('sidebar-collapsed', collapsed);
  elements.collapseSidebarButton.setAttribute('aria-expanded', String(!collapsed));
  elements.revealSidebarButton.setAttribute('aria-expanded', String(!collapsed));
  elements.sidebarResizer.tabIndex = collapsed ? -1 : 0;
  persistSidebarPreference(collapsed);
}

function setViewMode(viewMode) {
  state.viewMode = viewMode;
  const showDirectories = viewMode === 'directory';

  elements.directoryTab.classList.toggle('is-active', showDirectories);
  elements.imagesTab.classList.toggle('is-active', !showDirectories);
  elements.directoryTab.setAttribute('aria-selected', String(showDirectories));
  elements.imagesTab.setAttribute('aria-selected', String(!showDirectories));
  elements.directoryPanel.classList.toggle('is-active', showDirectories);
  elements.imagesPanel.classList.toggle('is-active', !showDirectories);
  elements.directoryPanel.hidden = !showDirectories;
  elements.imagesPanel.hidden = showDirectories;

  if (showDirectories) {
    renderDirectoryTree();
  } else {
    updateImageListSelection(true);
  }
}

function updateEmptyState({
  title = '打开一张图片开始浏览',
  description = '可直接打开图片或目录，也可以用鼠标滚轮、触控板和方向键切换图片。',
  showActions = true,
} = {}) {
  elements.emptyStateTitle.textContent = title;
  elements.emptyStateDescription.textContent = description;
  elements.emptyStateActions.hidden = !showActions;
}

function showEmptyViewer(options) {
  elements.stageContent.classList.add('is-hidden');
  elements.emptyState.hidden = false;
  updateEmptyState(options);
}

function updateNavigationAvailability() {
  const hasMultipleImages = state.images.length > 1;
  elements.previousZone.disabled = !hasMultipleImages;
  elements.nextZone.disabled = !hasMultipleImages;
}

function setCurrentDirectoryLabel(directoryPath, imageCount = 0) {
  const label = directoryPath ? basename(directoryPath) : '尚未打开目录';

  elements.currentDirectoryName.textContent = label;
  elements.currentDirectoryName.title = directoryPath || '';
  elements.imageListCount.textContent = `${imageCount} 张`;
  elements.refreshDirectoryButton.disabled = !directoryPath;
  elements.refreshImagesButton.disabled = !directoryPath;
}

function updateFitModeButton() {
  const mode = FIT_MODES[state.fitMode];
  elements.fitModeButton.querySelector('span').textContent = mode.label;
  elements.fitModeButton.title = `当前：${mode.label}，点击切换`;
}

function clearImageViewer({ title = '当前目录没有图片', description = '请选择其他目录，或直接打开一张图片。' } = {}) {
  state.imageLoadSequence += 1;
  state.currentIndex = -1;
  state.naturalWidth = 0;
  state.naturalHeight = 0;
  state.loadingImageUrl = null;
  state.baseWidth = 0;
  state.baseHeight = 0;
  state.zoom = 1;

  elements.mainImage.classList.remove('is-loaded');
  elements.mainImage.removeAttribute('src');
  elements.mainImage.alt = '';
  elements.zoomLayer.style.width = '';
  elements.zoomLayer.style.height = '';
  elements.imageName.textContent = '未选择图片';
  elements.imageName.title = '';
  elements.imagePosition.textContent = '—';
  document.title = '图片查看器';
  showEmptyViewer({ title, description });
  updateNavigationAvailability();
  updateImageListSelection(false);
}

function setImagePresentation() {
  if (!state.naturalWidth || !state.naturalHeight) {
    return;
  }

  const viewportWidth = Math.max(1, elements.stageViewport.clientWidth);
  const viewportHeight = Math.max(1, elements.stageViewport.clientHeight);
  const imageAspect = state.naturalWidth / state.naturalHeight;

  if (state.fitMode === 'actual') {
    state.baseWidth = state.naturalWidth;
    state.baseHeight = state.naturalHeight;
  } else if (state.fitMode === 'width') {
    state.baseWidth = viewportWidth;
    state.baseHeight = viewportWidth / imageAspect;
  } else {
    const scale = Math.min(viewportWidth / state.naturalWidth, viewportHeight / state.naturalHeight);
    state.baseWidth = state.naturalWidth * scale;
    state.baseHeight = state.naturalHeight * scale;
  }

  applyImageLayout();
}

function applyImageLayout() {
  if (!state.baseWidth || !state.baseHeight) {
    return;
  }

  const scaledWidth = state.baseWidth * state.zoom;
  const scaledHeight = state.baseHeight * state.zoom;

  elements.zoomLayer.style.width = `${scaledWidth}px`;
  elements.zoomLayer.style.height = `${scaledHeight}px`;
  elements.mainImage.style.width = `${state.baseWidth}px`;
  elements.mainImage.style.height = `${state.baseHeight}px`;
  elements.mainImage.style.transform = `scale(${state.zoom})`;
}

function updateImagePositionLabel() {
  if (state.currentIndex < 0 || state.images.length === 0) {
    elements.imagePosition.textContent = '—';
    return;
  }

  const position = `${state.currentIndex + 1} / ${state.images.length}`;

  if (state.naturalWidth && state.naturalHeight) {
    const zoomText = Math.abs(state.zoom - 1) > 0.005 ? ` · ${Math.round(state.zoom * 100)}%` : '';
    elements.imagePosition.textContent = `${position} · ${state.naturalWidth} × ${state.naturalHeight}${zoomText}`;
  } else {
    elements.imagePosition.textContent = position;
  }
}

function updateImageListSelection(scrollIntoView = true) {
  state.listItems.forEach((item, index) => {
    const isCurrent = index === state.currentIndex;
    item.classList.toggle('is-current', isCurrent);
    item.setAttribute('aria-selected', String(isCurrent));
  });

  if (scrollIntoView && state.viewMode === 'images' && state.currentIndex >= 0) {
    state.listItems[state.currentIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }
}

function selectImage(index, { resetZoom = true } = {}) {
  if (state.images.length === 0) {
    clearImageViewer();
    return;
  }

  const normalizedIndex = ((index % state.images.length) + state.images.length) % state.images.length;
  const image = state.images[normalizedIndex];
  const loadSequence = state.imageLoadSequence + 1;

  state.imageLoadSequence = loadSequence;
  state.currentIndex = normalizedIndex;
  state.naturalWidth = 0;
  state.naturalHeight = 0;
  state.baseWidth = 0;
  state.baseHeight = 0;

  if (resetZoom) {
    state.zoom = 1;
  }

  elements.emptyState.hidden = true;
  elements.stageContent.classList.remove('is-hidden');
  elements.mainImage.classList.remove('is-loaded');
  elements.mainImage.alt = image.name;
  elements.mainImage.src = image.url;
  state.loadingImageUrl = image.url;
  elements.imageName.textContent = image.name;
  elements.imageName.title = image.path;
  elements.imagePosition.textContent = `${normalizedIndex + 1} / ${state.images.length} · 正在加载`;
  document.title = `${image.name} · 图片查看器`;

  updateNavigationAvailability();
  updateImageListSelection(true);
}

function navigateImage(delta) {
  if (state.images.length <= 1) {
    return;
  }

  selectImage(state.currentIndex + delta);
}

function cycleFitMode() {
  state.fitMode = FIT_MODES[state.fitMode].next;
  state.zoom = 1;
  updateFitModeButton();

  if (state.naturalWidth && state.naturalHeight) {
    setImagePresentation();
    elements.stageViewport.scrollTo({ top: 0, left: 0 });
    updateImagePositionLabel();
  }
}

function handleImageLoaded() {
  const image = state.images[state.currentIndex];

  if (!image) {
    return;
  }

  const loadedUrl = elements.mainImage.currentSrc || elements.mainImage.src;
  if (loadedUrl && loadedUrl !== image.url) {
    return;
  }

  state.naturalWidth = elements.mainImage.naturalWidth;
  state.naturalHeight = elements.mainImage.naturalHeight;
  setImagePresentation();
  elements.mainImage.classList.add('is-loaded');
  updateImagePositionLabel();
}

function handleImageError() {
  const image = state.images[state.currentIndex];

  if (!image) {
    return;
  }

  const failedUrl = elements.mainImage.currentSrc || elements.mainImage.getAttribute('src');
  if (failedUrl && failedUrl !== image.url) {
    return;
  }

  elements.mainImage.classList.remove('is-loaded');
  elements.imagePosition.textContent = '无法显示';
  showToast(`无法加载图片：${image.name}`, { error: true });
}

async function loadDirectoryData(directoryPath, { force = false } = {}) {
  const key = pathKey(directoryPath);

  if (!force && state.directoryCache.has(key)) {
    return state.directoryCache.get(key);
  }

  if (!force && state.directoryRequests.has(key)) {
    return state.directoryRequests.get(key);
  }

  const request = api
    .listDirectory(directoryPath)
    .then((data) => {
      state.directoryCache.set(pathKey(data.path), data);
      state.directoryRequests.delete(key);
      return data;
    })
    .catch((error) => {
      state.directoryRequests.delete(key);
      throw error;
    });

  state.directoryRequests.set(key, request);
  return request;
}

async function loadCurrentDirectory(
  directoryPath,
  { preferredImagePath = null, preserveCurrentImage = false } = {},
) {
  const requestSequence = state.directoryLoadSequence + 1;
  state.directoryLoadSequence = requestSequence;

  const previousImagePath =
    preserveCurrentImage && state.currentIndex >= 0 ? state.images[state.currentIndex]?.path : null;

  try {
    const data = await loadDirectoryData(directoryPath, { force: true });

    if (requestSequence !== state.directoryLoadSequence) {
      return;
    }

    state.currentDirectory = data.path;
    state.images = data.images;
    state.currentIndex = -1;

    const wantedImagePath = preferredImagePath || previousImagePath;
    const wantedIndex = wantedImagePath
      ? state.images.findIndex((image) => pathsEqual(image.path, wantedImagePath))
      : -1;
    const nextIndex = wantedIndex >= 0 ? wantedIndex : 0;

    setCurrentDirectoryLabel(data.path, state.images.length);
    renderImageList();
    renderDirectoryTree();

    if (state.images.length > 0) {
      selectImage(nextIndex);
    } else {
      clearImageViewer();
    }
  } catch (error) {
    if (requestSequence !== state.directoryLoadSequence) {
      return;
    }

    showToast(`无法读取目录：${formatError(error)}`, { error: true });
  }
}

async function openRootDirectory(directoryPath, { preferredImagePath = null } = {}) {
  state.rootDirectory = directoryPath;
  state.directoryCache.clear();
  state.directoryRequests.clear();
  state.expandedDirectories = new Set([pathKey(directoryPath)]);

  await loadCurrentDirectory(directoryPath, { preferredImagePath });
}

async function openPath(targetPath) {
  try {
    const pathInfo = await api.getPathInfo(targetPath);

    if (pathInfo.kind === 'directory') {
      await openRootDirectory(pathInfo.path);
    } else {
      await openRootDirectory(pathInfo.directory, {
        preferredImagePath: pathInfo.path,
      });
    }
  } catch (error) {
    showToast(`无法打开：${formatError(error)}`, { error: true });
  }
}

async function chooseOpenFile() {
  try {
    const selectedPath = await api.openFileDialog();

    if (selectedPath) {
      await openPath(selectedPath);
    }
  } catch (error) {
    showToast(`无法打开文件：${formatError(error)}`, { error: true });
  }
}

async function chooseOpenDirectory() {
  try {
    const selectedPath = await api.openDirectoryDialog();

    if (selectedPath) {
      await openPath(selectedPath);
    }
  } catch (error) {
    showToast(`无法打开目录：${formatError(error)}`, { error: true });
  }
}

async function refreshCurrentDirectory() {
  if (!state.currentDirectory) {
    return;
  }

  const currentImagePath =
    state.currentIndex >= 0 ? state.images[state.currentIndex]?.path : null;

  await loadCurrentDirectory(state.currentDirectory, {
    preferredImagePath: currentImagePath,
    preserveCurrentImage: true,
  });
}

async function changeCurrentDirectory(directoryPath) {
  if (pathsEqual(directoryPath, state.currentDirectory)) {
    return;
  }

  await loadCurrentDirectory(directoryPath);
}

function createTreeChevron(expanded, hasChildren) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tree-toggle';
  button.classList.toggle('is-expanded', expanded);
  button.classList.toggle('is-empty', !hasChildren);
  button.tabIndex = hasChildren ? 0 : -1;
  button.setAttribute('aria-label', expanded ? '收起目录' : '展开目录');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>';
  return button;
}

function createFolderIcon() {
  const icon = document.createElement('span');
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 7.5h6l2-2h9v13h-17z" /></svg>';
  return icon.firstElementChild;
}

function appendDirectoryNode(container, directory, depth) {
  const key = pathKey(directory.path);
  const cachedData = state.directoryCache.get(key);
  const expanded = state.expandedDirectories.has(key);
  const hasChildren = cachedData ? cachedData.directories.length > 0 : true;

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.classList.toggle('is-current', pathsEqual(directory.path, state.currentDirectory));
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-expanded', String(hasChildren && expanded));
  row.style.paddingLeft = `${depth * 14}px`;

  const toggleButton = createTreeChevron(expanded, hasChildren);
  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();

    if (!hasChildren) {
      return;
    }

    if (expanded) {
      state.expandedDirectories.delete(key);
    } else {
      state.expandedDirectories.add(key);
    }

    renderDirectoryTree();
  });

  const nameButton = document.createElement('button');
  nameButton.type = 'button';
  nameButton.className = 'tree-name';
  nameButton.title = directory.path;
  nameButton.append(createFolderIcon());

  const label = document.createElement('span');
  label.textContent = depth === 0 ? basename(directory.path) || directory.path : directory.name;
  nameButton.append(label);

  nameButton.addEventListener('dblclick', (event) => {
    event.preventDefault();
    changeCurrentDirectory(directory.path);
  });

  nameButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      changeCurrentDirectory(directory.path);
    }
  });

  row.append(toggleButton, nameButton);
  container.append(row);

  if (!expanded || !hasChildren) {
    return;
  }

  const childContainer = document.createElement('div');
  childContainer.setAttribute('role', 'group');
  container.append(childContainer);

  if (!cachedData) {
    const loading = document.createElement('div');
    loading.className = 'tree-loading';
    loading.textContent = '正在读取…';
    childContainer.append(loading);

    if (!state.directoryRequests.has(key)) {
      loadDirectoryData(directory.path)
        .then(() => {
          if (state.expandedDirectories.has(key)) {
            renderDirectoryTree();
          }
        })
        .catch((error) => {
          if (state.expandedDirectories.has(key)) {
            renderDirectoryTree();
            showToast(`无法读取目录：${formatError(error)}`, { error: true });
          }
        });
    }

    return;
  }

  cachedData.directories.forEach((childDirectory) => {
    appendDirectoryNode(childContainer, childDirectory, depth + 1);
  });
}

function renderDirectoryTree() {
  if (!state.rootDirectory) {
    return;
  }

  const rootData = state.directoryCache.get(pathKey(state.rootDirectory));
  if (!rootData) {
    return;
  }

  const fragment = document.createDocumentFragment();
  appendDirectoryNode(fragment, { name: basename(rootData.path), path: rootData.path }, 0);
  elements.directoryTree.replaceChildren(fragment);
}

function createImageListItem(image, index) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'image-list-item';
  item.setAttribute('role', 'option');
  item.dataset.index = String(index);

  const thumbnail = document.createElement('span');
  thumbnail.className = 'image-list-thumb';

  const thumbnailImage = document.createElement('img');
  thumbnailImage.alt = '';
  thumbnailImage.decoding = 'async';
  thumbnailImage.dataset.src = image.url;
  thumbnail.append(thumbnailImage);

  const name = document.createElement('span');
  name.className = 'image-list-name';
  name.textContent = image.name;
  name.title = image.path;

  const number = document.createElement('span');
  number.className = 'image-list-index';
  number.textContent = String(index + 1);

  item.append(thumbnail, name, number);
  item.addEventListener('click', () => selectImage(index));
  return { item, thumbnailImage };
}

function renderImageList() {
  state.imageObserver?.disconnect();
  state.imageObserver = null;
  state.listItems = [];

  if (state.images.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.innerHTML =
      '<span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="17" height="16" rx="2.5" /><circle cx="9" cy="9" r="1.7" /><path d="m5.5 17 4.2-4.2 3 3 2-2 3.8 3.2" /></svg></span><p>当前目录暂无图片。</p>';
    elements.imageList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const pendingThumbnails = [];

  state.images.forEach((image, index) => {
    const { item, thumbnailImage } = createImageListItem(image, index);
    fragment.append(item);
    state.listItems.push(item);
    pendingThumbnails.push(thumbnailImage);
  });

  elements.imageList.replaceChildren(fragment);

  if ('IntersectionObserver' in window) {
    state.imageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const image = entry.target;
          if (image.dataset.src && !image.src) {
            image.src = image.dataset.src;
          }

          state.imageObserver?.unobserve(image);
        });
      },
      {
        root: elements.imageList,
        rootMargin: '240px 0px',
      },
    );

    pendingThumbnails.forEach((thumbnail) => state.imageObserver.observe(thumbnail));
  } else {
    pendingThumbnails.forEach((thumbnail) => {
      thumbnail.src = thumbnail.dataset.src;
    });
  }

  pendingThumbnails.forEach((thumbnail) => {
    thumbnail.addEventListener('load', () => thumbnail.classList.add('is-loaded'), { once: true });
    thumbnail.addEventListener(
      'error',
      () => {
        thumbnail.removeAttribute('src');
      },
      { once: true },
    );
  });

  updateImageListSelection(false);
}

function adjustZoom(nextZoom, clientX, clientY) {
  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

  if (Math.abs(clampedZoom - state.zoom) < 0.001) {
    return;
  }

  const oldZoom = state.zoom;
  const layerRect = elements.zoomLayer.getBoundingClientRect();
  const baseX = Math.min(state.baseWidth, Math.max(0, (clientX - layerRect.left) / oldZoom));
  const baseY = Math.min(state.baseHeight, Math.max(0, (clientY - layerRect.top) / oldZoom));

  state.zoom = clampedZoom;
  applyImageLayout();

  const nextRect = elements.zoomLayer.getBoundingClientRect();
  const nextX = nextRect.left + baseX * state.zoom;
  const nextY = nextRect.top + baseY * state.zoom;

  elements.stageViewport.scrollLeft += nextX - clientX;
  elements.stageViewport.scrollTop += nextY - clientY;
  updateImagePositionLabel();
}

function handleWheel(event) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const normalizedDelta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stageViewport.clientHeight : 1);
    adjustZoom(state.zoom * Math.exp(-normalizedDelta * 0.012), event.clientX, event.clientY);
    return;
  }

  const useHorizontalDelta =
    Math.abs(event.deltaX) > 6 &&
    Math.abs(event.deltaX) >= Math.abs(event.deltaY) * 0.85;
  const rawDelta = useHorizontalDelta ? event.deltaX : event.deltaY;
  const normalizedDelta =
    rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? elements.stageViewport.clientHeight : 1);

  if (Math.abs(normalizedDelta) <= 1) {
    return;
  }

  event.preventDefault();
  navigateFromWheelGesture(normalizedDelta);
}

function navigateFromWheelGesture(delta) {
  window.clearTimeout(state.stageWheelGestureTimer);

  if (!state.stageWheelGestureLocked) {
    if (
      state.stageWheelAccumulatedDelta !== 0 &&
      Math.sign(delta) !== Math.sign(state.stageWheelAccumulatedDelta)
    ) {
      state.stageWheelAccumulatedDelta = 0;
    }

    state.stageWheelAccumulatedDelta += delta;

    if (Math.abs(state.stageWheelAccumulatedDelta) >= WHEEL_NAVIGATION_THRESHOLD) {
      state.stageWheelGestureLocked = true;
      state.stageWheelAccumulatedDelta = 0;
      navigateImage(delta > 0 ? 1 : -1);
    }
  }

  state.stageWheelGestureTimer = window.setTimeout(() => {
    state.stageWheelGestureLocked = false;
    state.stageWheelAccumulatedDelta = 0;
    state.stageWheelGestureTimer = null;
  }, WHEEL_GESTURE_IDLE_MS);
}

function handleKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) {
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    navigateImage(-1);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    navigateImage(1);
  }
}

function handleGestureStart(event) {
  event.preventDefault();
  state.gestureStartZoom = state.zoom;
}

function handleGestureChange(event) {
  if (!Number.isFinite(event.scale)) {
    return;
  }

  event.preventDefault();
  adjustZoom(state.gestureStartZoom * event.scale, event.clientX, event.clientY);
}

function bindEvents() {
  elements.collapseSidebarButton.addEventListener('click', () => setSidebarCollapsed(true));
  elements.revealSidebarButton.addEventListener('click', () => setSidebarCollapsed(false));
  elements.sidebarResizer.addEventListener('pointerdown', handleSidebarResizeStart);
  elements.sidebarResizer.addEventListener('pointermove', handleSidebarResizeMove);
  elements.sidebarResizer.addEventListener('pointerup', handleSidebarResizeEnd);
  elements.sidebarResizer.addEventListener('pointercancel', handleSidebarResizeEnd);
  elements.sidebarResizer.addEventListener('dblclick', () => {
    applySidebarWidth(getDefaultSidebarWidth());
    persistSidebarWidth(state.sidebarWidth);
  });
  elements.sidebarResizer.addEventListener('keydown', handleSidebarResizerKeyDown);

  elements.directoryTab.addEventListener('click', () => setViewMode('directory'));
  elements.imagesTab.addEventListener('click', () => setViewMode('images'));

  elements.previousZone.addEventListener('click', () => navigateImage(-1));
  elements.nextZone.addEventListener('click', () => navigateImage(1));
  elements.fitModeButton.addEventListener('click', cycleFitMode);

  elements.openFileButton.addEventListener('click', chooseOpenFile);
  elements.openDirectoryButton.addEventListener('click', chooseOpenDirectory);
  elements.refreshDirectoryButton.addEventListener('click', refreshCurrentDirectory);
  elements.refreshImagesButton.addEventListener('click', refreshCurrentDirectory);

  elements.mainImage.addEventListener('load', handleImageLoaded);
  elements.mainImage.addEventListener('error', handleImageError);

  elements.stageViewport.addEventListener('wheel', handleWheel, { passive: false });
  elements.stageViewport.addEventListener('gesturestart', handleGestureStart);
  elements.stageViewport.addEventListener('gesturechange', handleGestureChange);
  document.addEventListener('keydown', handleKeyDown);

  const resizeObserver = new ResizeObserver(() => {
    const width = elements.stageViewport.clientWidth;
    const height = elements.stageViewport.clientHeight;

    if (width === state.lastStageWidth && height === state.lastStageHeight) {
      return;
    }

    state.lastStageWidth = width;
    state.lastStageHeight = height;

    if (state.naturalWidth && state.naturalHeight) {
      setImagePresentation();
      updateImagePositionLabel();
    }
  });
  resizeObserver.observe(elements.stageViewport);

  window.addEventListener('resize', () => {
    applySidebarWidth(state.sidebarWidth ?? getDefaultSidebarWidth());
  });

  window.addEventListener('beforeunload', () => {
    window.clearTimeout(state.stageWheelGestureTimer);
    resizeObserver.disconnect();
    state.imageObserver?.disconnect();
  });
}

function initialize() {
  if (!api) {
    showToast('应用初始化失败：预加载接口不可用。', { error: true, duration: 10000 });
    return;
  }

  const initialSidebarWidth =
    state.sidebarWidth ?? elements.sidebar.getBoundingClientRect().width;
  applySidebarWidth(initialSidebarWidth);
  setSidebarCollapsed(state.sidebarCollapsed);
  setViewMode(state.viewMode);
  updateFitModeButton();
  updateNavigationAvailability();
  bindEvents();

  api.onOpenPath((targetPath) => {
    openPath(targetPath);
  });
}

initialize();
