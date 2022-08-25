const store: { [namespace: string]: any } = {};

const models: { [namespace: string]: Model } = {};

const dispatchs: { [uniqueId: string]: any } = {};

const suspendedGenerators: { [namespace: string]: { [actionType: string]: Generator } } = {};

const takeGeneratorsBinders: { [namespace: string]: { [actionType: string]: Function } } = {};

interface Async {
    put: typeof connect.dispatch;
    call: typeof async.call;
    select: typeof async.select;
    all: typeof async.all;
    take: typeof async.take;
}

export interface Model {
    namespace: string;
    state: any;
    reducers: {
        [props: string]: (state: object, dispatchState: object) => object;
    };
    effects?: {
        [props: string]: [(dispatchState: any, async: Async) => any, TakeType] | ((dispatchState: any, async: Async) => any);
    };
}

export type TakeType = { type: 'takeLatest' | 'takeEvery' };

export type MapStateToProps = (_store: any) => any;

export type Action = { type: string; [props: string]: any };

export type UseConnectType = [any, (action: Action) => void];

export interface ConnectConfigProps {
    withRef: boolean;
}

const reducer: React.Reducer<any, Action> = () => {
    return { ...store };
};

function generateId(): string {
    return Math.random().toString(16) + (+new Date()).toString(16);
}
function dispatchStore(namespaces: string[], dispatchId: React.MutableRefObject<string>, dispatch: Function) {
    if (!dispatchId.current) {
        dispatchId.current = generateId();
        namespaces.forEach((namespace: string) => {
            !dispatchs[namespace] && (dispatchs[namespace] = {});
            dispatchs[namespace][dispatchId.current] = dispatch;
        });
    }
}
function dispatchEffect() {
    return () => {
        this.namespaces.forEach((namespace: string) => {
            dispatchs[namespace][this.dispatchId] = null;
            delete dispatchs[namespace][this.dispatchId];

            if (!Object.getOwnPropertyNames(dispatchs[namespace]).length) {
                delete dispatchs[namespace];
            }
        });
    };
}
/**
 * 将当前组件与全局store关联 --Hook用法
 * @param {MapStateToProps} mapStateToProps 状态到属性props，传递给组件
 * @param {string[]} namespaces 模型命名空间字符串组成的数组
 * @returns {JSX.Element}
 */
function useConnect(mapStateToProps: MapStateToProps, namespaces: string[]): UseConnectType {
    const [state, dispatch] = React.useReducer(reducer, store);
    const dispatchId = React.useRef('');

    dispatchStore(namespaces, dispatchId, dispatch);
    React.useEffect(dispatchEffect.bind({ namespaces, dispatchId: dispatchId.current }), []);
    const mapState = mapStateToProps(state);

    return [mapState, connect.dispatch];
}

/**
 * 将当前组件与全局store关联--Class组件用法(同时支持函数组件)
 * @param {MapStateToProps} mapStateToProps 状态到属性props，传递给组件
 * @param {string[]} namespaces 模型命名空间字符串组成的数组
 * @param {connectConfigProps} config 可设置是否获取组件的ref
 * @returns {JSX.Element}
 */
function connect(mapStateToProps: MapStateToProps, namespaces: string[], config?: ConnectConfigProps) {
    return function (Component: React.ElementType) {
        if (!namespaces) {
            console.error('请传入与该组件相关的namespaces');
            return null;
        }
        const withRef = config && config.withRef;
        function ConnectComponent(props: any = {}, ref: React.Ref<any>): JSX.Element {
            if (!store[namespaces[0]]) {
                const getDerivedStateFromProps = (Component as any).getDerivedStateFromProps;
                getDerivedStateFromProps && getDerivedStateFromProps();
            }

            const dispatchId = React.useRef('');
            const [state, dispatch] = React.useReducer(reducer, store);

            dispatchStore(namespaces, dispatchId, dispatch);
            React.useEffect(dispatchEffect.bind({ namespaces, dispatchId: dispatchId.current }), []);

            const mapState = mapStateToProps(store);
            const componentProps = { ...mapState, ...props };
            return React.useMemo(
                () => {
                    if (withRef) {
                        return <Component ref={ref} dispatch={connect.dispatch} {...componentProps} />;
                    }
                    return <Component dispatch={connect.dispatch} {...componentProps} />;
                },
                Object.keys(componentProps).map((prop) => (componentProps[prop] === undefined ? prop : componentProps[prop]))
            );
        }

        if (withRef) {
            return React.forwardRef(ConnectComponent);
        }
        return ConnectComponent;
    };
}

/**
 * 装载model
 * @param model 模型对象
 */
connect.model = function (model: Model) {
    if (models[model.namespace]) {
        return;
    }
    //初始化model数据
    store[model.namespace] = model.state;

    //初始化model
    models[model.namespace] = model;
};

/**
 * 卸载model
 * @param model 模型对象
 */
connect.unmodel = function (namespace: string) {
    //卸载model相关数据
    store[namespace] = null;
    delete store[namespace];

    //卸载model
    models[namespace] = null;
    delete models[namespace];

    //卸载相关的异步流缓存
    suspendedGenerators[namespace] = null;
    delete suspendedGenerators[namespace];
    takeGeneratorsBinders[namespace] = null;
    delete takeGeneratorsBinders[namespace];
};

/**
 * 获取所有model
 * @returns
 */
connect.models = models;

/**获取全局单例状态副本*/
connect.getState = function (namespace?: string) {
    if (namespace) {
        return store[namespace];
    }
    return { ...store };
};

/**发起action*/
connect.dispatch = function (action: Action) {
    const { type, ...state } = action;
    const [namespace, key] = type.split('/');
    if (!models[namespace]) {
        console.warn('未加载该命名空间的model，发起更新失败，请检查type', type);
        return;
    }

    //执行监听中的takeAction，执行完后删除
    const takeGeneratorsBinder = takeGeneratorsBinders[namespace]?.[type];
    if (takeGeneratorsBinder) {
        takeGeneratorsBinder(state);
        takeGeneratorsBinders[namespace][type] = null;
        delete takeGeneratorsBinders[namespace][type];
    }

    const effect = models[namespace]?.effects?.[key];
    if (effect) {
        let takeType: TakeType;
        let effectFunc = effect as Function;

        if (effect instanceof Array) {
            effectFunc = effect[0];
            takeType = effect[1];
        }

        const suspendedGenerator: Generator = suspendedGenerators[namespace]?.[type];
        //如果之前已经存在该type的suspendedGenerator，则直接停止执行并丢弃，继续执行新的Generator
        if (suspendedGenerator && takeType && takeType.type === 'takeLatest') {
            suspendedGenerator.return('canceled');
            suspendedGenerators[namespace][type] = null;
            delete suspendedGenerators[namespace][type];
        }

        const generator = effectFunc(action, {
            ...async,
            put: async.put(namespace),
            take: async.take.bind({ namespace })
        });
        return new Promise((res, rej) => {
            if (generator?.next) {
                //存储当前的Generator
                if (takeType && takeType.type === 'takeLatest') {
                    suspendedGenerators[namespace] = suspendedGenerators[namespace] || {};
                    suspendedGenerators[namespace][type] = generator;
                }
                GeneratorExec.bind({ generator, finished: res })();
                return;
            }
            res(generator);
        });
    }

    const reducer = models[namespace]?.reducers?.[key];
    if (!reducer || typeof reducer !== 'function') {
        return;
    }

    const reducerState = reducer(store[namespace], state);

    //如果状态没有变化，则直接返回，不触发更新
    let update = true;
    try {
        if (JSON.stringify(reducerState) === JSON.stringify(store[namespace])) {
            update = false;
        }
    } catch (err) {}

    if (!update) {
        return;
    }
    //更新全局状态
    store[namespace] = reducerState;
    //限制在当前namesapce命名空间下进行dispatch,避免执行很多不必要的程序
    for (const dispatchId in dispatchs[namespace]) {
        dispatchs[namespace][dispatchId]({ type, reducerState });
    }
};

//处理generator
function GeneratorExec(promiseValue?: any, manualValue?: any) {
    var GeneratorExecBinder = GeneratorExec.bind(this);
    const { value, done } = manualValue || this.generator.next(promiseValue);
    if (promiseValue instanceof Function) {
        promiseValue();
    }
    if (done) {
        this.finished(value);
        return;
    }
    if (value instanceof Promise) {
        value.then(GeneratorExecBinder).catch((error) => {
            GeneratorExecBinder(undefined, this.generator.throw(new Error(error)));
            //临时保留不拋异常，继续往下执行的逻辑-勿删
            // GeneratorExecBinder({ error, data: { success: false } });
        });
        return;
    }

    if (value instanceof AsyncType) {
        //如果是take，暂存并监听该action
        if (value.type === 'take') {
            const namespace = value.value.split('/')[0];
            takeGeneratorsBinders[namespace] = takeGeneratorsBinders[namespace] || {};
            takeGeneratorsBinders[namespace][value.value] = GeneratorExecBinder;
            return;
        }
        if (value.type === 'put') {
            const [namespace, key] = value.value.type.split('/');
            if (models[namespace]?.effects?.[key]) {
                const manualValue = this.generator.next();
                connect.dispatch(value.value);
                GeneratorExecBinder(null, manualValue);
                return;
            }
            connect.dispatch(value.value);
        }
        if (value.type === 'put.resolve') {
            const dispatchResult = connect.dispatch(value.value);
            if (dispatchResult instanceof Promise) {
                dispatchResult.then(GeneratorExecBinder);
                return;
            }
            GeneratorExecBinder(dispatchResult);
            return;
        }
    }

    GeneratorExecBinder(value);
}

/**异步类型*/
class AsyncType {
    /**
     * @param type 异步类型
     * @param value 异步传参值
     */
    constructor(public type: string, public value?: any) {
        this.type = type;
        this.value = value;
    }
}

/**模拟saga 函数 */
const async = {
    put: function (namespace: string) {
        function put(action: Action) {
            if (!action.type.includes('/')) {
                action.type = namespace + '/' + action.type;
            }

            return new (AsyncType as any)('put', action);
        }

        put.resolve = function (action: Action) {
            if (!action.type.includes('/')) {
                action.type = namespace + '/' + action.type;
            }
            return new (AsyncType as any)('put.resolve', action);
        };

        return put;
    },
    call: function (callFunc: Function, ...args: any[]) {
        return callFunc(...args);
    },
    select: function (selectFunc?: (clone_store: typeof store) => any) {
        return selectFunc ? selectFunc({ ...store }) : { ...store };
    },
    all: function (promiseArray: (Promise<any> | AsyncType)[]): Promise<any> {
        return Promise.all(
            promiseArray.map((item: any) => {
                if (item instanceof AsyncType) {
                    return connect.dispatch(item.value);
                }
                return item;
            })
        );
    },
    take: function (actionKey: string) {
        if (!actionKey.includes('/')) {
            actionKey = this.namespace + '/' + actionKey;
        }
        return new (AsyncType as any)('take', actionKey);
    }
};

export { useConnect, connect };
