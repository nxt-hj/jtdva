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

export type UseConnectType = [state: any, dispatch: (action: Action) => void];

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
 * ????????????????????????store?????? --Hook??????
 * @param {MapStateToProps} mapStateToProps ???????????????props??????????????????
 * @param {string[]} namespaces ??????????????????????????????????????????
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
 * ????????????????????????store??????--Class????????????(????????????????????????)
 * @param {MapStateToProps} mapStateToProps ???????????????props??????????????????
 * @param {string[]} namespaces ??????????????????????????????????????????
 * @param {connectConfigProps} config ??????????????????????????????ref
 * @returns {JSX.Element}
 */
function connect(mapStateToProps: MapStateToProps, namespaces: string[], config?: ConnectConfigProps) {
    return function (Component: React.ElementType) {
        if (!namespaces) {
            console.error('??????????????????????????????namespaces');
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
 * ??????model
 * @param model ????????????
 */
connect.model = function (model: Model) {
    if (models[model.namespace]) {
        return;
    }
    //?????????model??????
    store[model.namespace] = model.state;

    //?????????model
    models[model.namespace] = model;
};

/**
 * ??????model
 * @param model ????????????
 */
connect.unmodel = function (namespace: string) {
    //??????model????????????
    store[namespace] = null;
    delete store[namespace];

    //??????model
    models[namespace] = null;
    delete models[namespace];

    //??????????????????????????????
    suspendedGenerators[namespace] = null;
    delete suspendedGenerators[namespace];
    takeGeneratorsBinders[namespace] = null;
    delete takeGeneratorsBinders[namespace];
};

/**
 * ????????????model
 * @returns
 */
connect.models = models;

/**??????????????????????????????*/
connect.getState = function (namespace?: string) {
    if (namespace) {
        return store[namespace];
    }
    return { ...store };
};

/**??????action*/
connect.dispatch = function (action: Action) {
    const { type, ...state } = action;
    const [namespace, key] = type.split('/');
    if (!models[namespace]) {
        console.warn('???????????????????????????model?????????????????????????????????type', type);
        return;
    }

    //??????????????????takeAction?????????????????????
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
        //???????????????????????????type???suspendedGenerator??????????????????????????????????????????????????????Generator
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
                //???????????????Generator
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

    //????????????????????????????????????????????????????????????
    let update = true;
    try {
        if (JSON.stringify(reducerState) === JSON.stringify(store[namespace])) {
            update = false;
        }
    } catch (err) {}

    if (!update) {
        return;
    }
    //??????????????????
    store[namespace] = reducerState;
    //???????????????namesapce?????????????????????dispatch,????????????????????????????????????
    for (const dispatchId in dispatchs[namespace]) {
        dispatchs[namespace][dispatchId]({ type, reducerState });
    }
};

//??????generator
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
            GeneratorExecBinder({ error, data: { success: false } });
        });
        return;
    }

    if (value instanceof AsyncType) {
        //?????????take?????????????????????action
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

/**????????????*/
class AsyncType {
    /**
     * @param type ????????????
     * @param value ???????????????
     */
    constructor(public type: string, public value?: any) {
        this.type = type;
        this.value = value;
    }
}

/**??????saga ?????? */
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
